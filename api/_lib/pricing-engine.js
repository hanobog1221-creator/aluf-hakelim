const DEFAULT_POLICY = Object.freeze({
  enabled: true,
  targetNetProfitIls: 20,
  safetyNetProfitIls: 1,
  vatRate: 0.18,
  serviceFeeRate: 0.05,
  processingFeeRate: 0.03,
  taxReserveRate: 0.40,
  advertisingCostIls: 15,
  cancellationRate: 0.05,
  refundFeeIls: 49,
  supplierBufferRate: 0.05,
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
    // The owner set a fixed business target of 20 ILS net per product.
    // Keep this authoritative even if an older deployment environment still says 25.
    targetNetProfitIls: DEFAULT_POLICY.targetNetProfitIls,
    safetyNetProfitIls: DEFAULT_POLICY.safetyNetProfitIls,
    // Production readiness in Supabase audits against these conservative floors.
    // Environment overrides may add reserve, but must never undercut the audit.
    vatRate: Math.max(DEFAULT_POLICY.vatRate, envNumber(env, 'PRICING_VAT_RATE', DEFAULT_POLICY.vatRate, 0, 1)),
    serviceFeeRate: Math.max(DEFAULT_POLICY.serviceFeeRate, envNumber(env, 'PRICING_SERVICE_FEE_RATE', DEFAULT_POLICY.serviceFeeRate, 0, 1)),
    processingFeeRate: Math.max(DEFAULT_POLICY.processingFeeRate, envNumber(env, 'PRICING_PROCESSING_FEE_RATE', DEFAULT_POLICY.processingFeeRate, 0, 1)),
    taxReserveRate: Math.max(DEFAULT_POLICY.taxReserveRate, envNumber(env, 'PRICING_TAX_RESERVE_RATE', DEFAULT_POLICY.taxReserveRate, 0, 0.95)),
    advertisingCostIls: Math.max(DEFAULT_POLICY.advertisingCostIls, envNumber(env, 'PRICING_AD_COST_ILS', DEFAULT_POLICY.advertisingCostIls)),
    cancellationRate: Math.max(DEFAULT_POLICY.cancellationRate, envNumber(env, 'PRICING_CANCELLATION_RATE', DEFAULT_POLICY.cancellationRate, 0, 1)),
    refundFeeIls: Math.max(DEFAULT_POLICY.refundFeeIls, envNumber(env, 'PRICING_REFUND_FEE_ILS', DEFAULT_POLICY.refundFeeIls)),
    supplierBufferRate: Math.max(DEFAULT_POLICY.supplierBufferRate, envNumber(env, 'PRICING_SUPPLIER_BUFFER_RATE', DEFAULT_POLICY.supplierBufferRate, 0, 1)),
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
    operatingProfitTarget
  ) / retainedRate;
  const unroundedProductPrice = Math.max(0, requiredCustomerTotal - supplierShipping);
  const recommendedProductPrice = roundRetailUp(unroundedProductPrice, policy.priceEnding);
  const customerTotal = recommendedProductPrice + supplierShipping;
  const vat = customerTotal - (customerTotal / (1 + policy.vatRate));
  const serviceFee = customerTotal * policy.serviceFeeRate;
  const processingFee = customerTotal * policy.processingFeeRate;
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
