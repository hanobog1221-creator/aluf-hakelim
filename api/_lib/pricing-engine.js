const DEFAULT_POLICY = Object.freeze({
  enabled: true,
  targetNetProfitIls: 10,
  safetyNetProfitIls: 0,
  vatRate: 0,
  serviceFeeRate: 0,
  // Whop card pricing is 2.7% + $0.30. The additional 1.5% international
  // and 1% FX fees are included so the ten-shekel floor survives ordinary
  // cross-border card transactions. $0.30 is rounded up at the current rate.
  processingFeeRate: 0.052,
  processingFeeFixedIls: 1.20,
  taxReserveRate: 0,
  advertisingCostIls: 0,
  cancellationRate: 0,
  refundFeeIls: 0,
  supplierBufferRate: 0,
  priceEnding: 0.90
});

function envNumber(env, key, fallback, min = 0, max = 1_000_000) {
  const raw = env?.[key];
  if (raw === null || raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return value;
}

function pricingPolicy(env = process.env) {
  return {
    enabled: String(env.AUTO_PRICING_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
    // The owner set a fixed target of 10 ILS per unit after supplier cost and
    // transaction fees only. Old deployment variables must not restore the
    // former VAT, advertising, insurance, cancellation or buffer reserves.
    targetNetProfitIls: DEFAULT_POLICY.targetNetProfitIls,
    safetyNetProfitIls: DEFAULT_POLICY.safetyNetProfitIls,
    vatRate: DEFAULT_POLICY.vatRate,
    serviceFeeRate: DEFAULT_POLICY.serviceFeeRate,
    processingFeeRate: Math.max(DEFAULT_POLICY.processingFeeRate, envNumber(env, 'PRICING_PROCESSING_FEE_RATE', DEFAULT_POLICY.processingFeeRate, 0, 1)),
    processingFeeFixedIls: Math.max(DEFAULT_POLICY.processingFeeFixedIls, envNumber(env, 'PRICING_PROCESSING_FEE_FIXED_ILS', DEFAULT_POLICY.processingFeeFixedIls)),
    taxReserveRate: DEFAULT_POLICY.taxReserveRate,
    advertisingCostIls: DEFAULT_POLICY.advertisingCostIls,
    cancellationRate: DEFAULT_POLICY.cancellationRate,
    refundFeeIls: DEFAULT_POLICY.refundFeeIls,
    supplierBufferRate: DEFAULT_POLICY.supplierBufferRate,
    priceEnding: envNumber(env, 'PRICING_PRICE_ENDING', DEFAULT_POLICY.priceEnding, 0, 0.99)
  };
}

function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

function roundRetailUp(value, ending = 0.90) {
  if (!Number.isFinite(value) || value < 0) return null;
  const whole = Math.floor(value);
  const candidate = whole + ending;
  return money(candidate + 1e-9 >= value ? candidate : whole + 1 + ending);
}

function quoteProductPrice({ supplierPriceIls, supplierShippingIls, policy = pricingPolicy() }) {
  if (supplierPriceIls === null || supplierPriceIls === undefined || supplierPriceIls === '' ||
      supplierShippingIls === null || supplierShippingIls === undefined || supplierShippingIls === '') {
    return { ready: false, reason: 'supplier_cost_or_shipping_unknown', policy };
  }
  const supplierPrice = Number(supplierPriceIls);
  const supplierShipping = Number(supplierShippingIls);
  if (!Number.isFinite(supplierPrice) || supplierPrice < 0 || !Number.isFinite(supplierShipping) || supplierShipping < 0) {
    return { ready: false, reason: 'supplier_cost_or_shipping_unknown', policy };
  }

  const retainedRate = (1 / (1 + policy.vatRate)) - policy.serviceFeeRate - policy.processingFeeRate;
  if (!Number.isFinite(retainedRate) || retainedRate <= 0) {
    return { ready: false, reason: 'invalid_pricing_policy', policy };
  }

  const supplierTotal = supplierPrice + supplierShipping;
  const supplierBuffer = supplierTotal * policy.supplierBufferRate;
  const cancellationReserve = policy.cancellationRate * policy.refundFeeIls;
  const operatingProfitTarget = (policy.targetNetProfitIls + policy.safetyNetProfitIls) / (1 - policy.taxReserveRate);
  const requiredCustomerTotal = (
    supplierTotal +
    supplierBuffer +
    policy.advertisingCostIls +
    cancellationReserve +
    policy.processingFeeFixedIls +
    operatingProfitTarget
  ) / retainedRate;
  const unroundedProductPrice = Math.max(0, requiredCustomerTotal - supplierShipping);
  const recommendedProductPrice = roundRetailUp(unroundedProductPrice, policy.priceEnding);
  const customerTotal = recommendedProductPrice + supplierShipping;
  const vat = customerTotal - (customerTotal / (1 + policy.vatRate));
  const serviceFee = customerTotal * policy.serviceFeeRate;
  const processingFee = customerTotal * policy.processingFeeRate + policy.processingFeeFixedIls;
  const operatingProfit = customerTotal - vat - serviceFee - processingFee - supplierTotal - supplierBuffer - policy.advertisingCostIls - cancellationReserve;
  const estimatedNetProfit = operatingProfit * (1 - policy.taxReserveRate);

  return {
    ready: true,
    recommendedProductPrice: money(recommendedProductPrice),
    recommendedCustomerTotal: money(customerTotal),
    supplierTotal: money(supplierTotal),
    supplierBuffer: money(supplierBuffer),
    advertisingCost: money(policy.advertisingCostIls),
    cancellationReserve: money(cancellationReserve),
    estimatedVat: money(vat),
    serviceFee: money(serviceFee),
    processingFee: money(processingFee),
    operatingProfitBeforePersonalTax: money(operatingProfit),
    estimatedNetProfit: money(estimatedNetProfit),
    retainedRate: Number(retainedRate.toFixed(6)),
    policy
  };
}

function autoPriceUpdate(product, costs = {}, env = process.env) {
  const policy = pricingPolicy(env);
  const supplierPriceIls = costs.supplierPriceIls ?? product?.supplier_price_ils;
  const supplierShippingIls = costs.supplierShippingIls ?? product?.supplier_shipping;
  const quote = quoteProductPrice({ supplierPriceIls, supplierShippingIls, policy });
  if (!policy.enabled || !quote.ready) return { quote, update: {} };
  const current = Number(product?.selling_price);
  const next = quote.recommendedProductPrice;
  if (Number.isFinite(current) && Math.abs(current - next) < 0.005) return { quote, update: {} };
  return {
    quote,
    update: {
      old_price: Number.isFinite(current) && current > next ? money(current) : (product?.old_price ?? null),
      selling_price: next
    }
  };
}

module.exports = {
  DEFAULT_POLICY,
  pricingPolicy,
  quoteProductPrice,
  autoPriceUpdate,
  roundRetailUp
};
