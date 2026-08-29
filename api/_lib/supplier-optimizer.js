const DEFAULT_QUOTE_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_MINIMUM_PROFIT_ILS = 10;
const DEFAULT_PRICING_SAFETY_NET_ILS = 0;
const DEFAULT_TAX_RESERVE_PERCENT = 0;
const DEFAULT_INSURANCE_RESERVE_PERCENT = 0;
const AUTO_FULFILLMENT_PROVIDERS = new Set(['aliexpress', 'cj']);

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
}

function providerOf(value) {
  return String(value || '').trim().toLowerCase();
}

function quoteTime(offer) {
  const productAt = Date.parse(offer?.last_sync_at || offer?.lastSyncAt || '');
  const shippingAt = Date.parse(offer?.shipping_last_checked_at || offer?.shippingLastCheckedAt || '');
  if (!Number.isFinite(productAt) || !Number.isFinite(shippingAt)) return null;
  return Math.min(productAt, shippingAt);
}

function normalizeOffer(offer) {
  const provider = providerOf(offer?.provider || offer?.supplier);
  const productPrice = money(offer?.product_price_ils ?? offer?.supplier_price_ils ?? offer?.supplierPriceIls);
  const shippingPrice = money(offer?.shipping_price_ils ?? offer?.supplier_shipping ?? offer?.supplierShipping);
  const checkedAt = quoteTime(offer);
  const deliveryDays = Number(offer?.estimated_delivery_days ?? offer?.estimatedDeliveryDays);
  return {
    ...offer,
    provider,
    productPrice,
    shippingPrice,
    landedCost: productPrice === null || shippingPrice === null ? null : money(productPrice + shippingPrice),
    checkedAt,
    estimatedDeliveryDays: Number.isFinite(deliveryDays) && deliveryDays >= 0 ? deliveryDays : null,
    equivalenceVerified: offer?.equivalence_verified === true || offer?.equivalenceVerified === true || offer?.verified === true,
    fulfillmentSupported: offer?.fulfillment_supported === true || offer?.fulfillmentSupported === true,
    inStock: offer?.in_stock === true || offer?.supplier_in_stock === true,
    shippingAvailable: offer?.shipping_available === true || offer?.supplier_shipping_available === true
  };
}

function offerBlockers(offer, options = {}) {
  const normalized = normalizeOffer(offer);
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const ttlMs = Number.isFinite(Number(options.ttlMs)) ? Number(options.ttlMs) : DEFAULT_QUOTE_TTL_MS;
  const enabledProviders = options.enabledProviders instanceof Set ? options.enabledProviders : null;
  const blockers = [];
  if (!normalized.provider) blockers.push('provider_missing');
  if (enabledProviders && !enabledProviders.has(normalized.provider)) blockers.push('provider_disabled');
  if (!normalized.equivalenceVerified) blockers.push('product_equivalence_not_verified');
  if (!normalized.fulfillmentSupported) blockers.push('automatic_fulfillment_not_supported');
  if (!normalized.inStock) blockers.push(offer?.in_stock === false || offer?.supplier_in_stock === false ? 'out_of_stock' : 'stock_unknown');
  if (!normalized.shippingAvailable) blockers.push(offer?.shipping_available === false || offer?.supplier_shipping_available === false ? 'shipping_unavailable' : 'shipping_unknown');
  if (normalized.productPrice === null) blockers.push('product_price_unknown');
  if (normalized.shippingPrice === null) blockers.push('shipping_price_unknown');
  if (normalized.checkedAt === null || now - normalized.checkedAt > ttlMs || normalized.checkedAt > now + 60_000) blockers.push('quote_stale');
  if (!String(offer?.supplier_product_id || offer?.supplierProductId || '').trim()) blockers.push('supplier_product_id_missing');
  if (!String(offer?.supplier_sku_id || offer?.supplierSkuId || '').trim()) blockers.push('supplier_sku_id_missing');
  if (normalized.provider === 'aliexpress' && !String(offer?.supplier_sku_attr || offer?.supplierSkuAttr || '').trim()) blockers.push('supplier_sku_attr_missing');
  return { normalized, blockers };
}

function selectBestOffer(offers, options = {}) {
  const evaluated = (Array.isArray(offers) ? offers : []).map((offer) => {
    const result = offerBlockers(offer, options);
    return { offer, ...result, eligible: result.blockers.length === 0 };
  });
  const eligible = evaluated.filter((row) => row.eligible);
  eligible.sort((a, b) => {
    const cost = a.normalized.landedCost - b.normalized.landedCost;
    if (Math.abs(cost) > 0.001) return cost;
    const aDays = a.normalized.estimatedDeliveryDays ?? Number.MAX_SAFE_INTEGER;
    const bDays = b.normalized.estimatedDeliveryDays ?? Number.MAX_SAFE_INTEGER;
    if (aDays !== bDays) return aDays - bDays;
    return a.normalized.provider.localeCompare(b.normalized.provider);
  });
  return { selected: eligible[0] || null, evaluated };
}

function requiredSellingPrice(productPriceIls, minimumProfitIls = DEFAULT_MINIMUM_PROFIT_ILS, options = {}) {
  const productCost = money(productPriceIls);
  const requestedMinimumProfit = money(minimumProfitIls);
  const minimumProfit = requestedMinimumProfit === null ? null : Math.max(DEFAULT_MINIMUM_PROFIT_ILS, requestedMinimumProfit);
  const reserve = money(options.reserveIls || 0);
  const percent = Number(options.paymentFeePercent || 0);
  const fixed = money(options.paymentFeeFixedIls || 0);
  const customerShipping = money(options.customerShippingIls || 0);
  const taxPercent = Number(options.taxReservePercent ?? DEFAULT_TAX_RESERVE_PERCENT);
  const insurancePercent = Number(options.insuranceReservePercent ?? DEFAULT_INSURANCE_RESERVE_PERCENT);
  const vatRate = Number(options.vatRate || 0);
  const serviceFeeRate = Number(options.serviceFeePercent || 0) / 100;
  const supplierBufferRate = Number(options.supplierBufferPercent || 0) / 100;
  const advertisingCost = money(options.advertisingCostIls || 0);
  const cancellationReserve = money(options.cancellationReserveIls || 0);
  if (productCost === null || productCost < 0) throw new Error('invalid_product_cost');
  if (minimumProfit === null || minimumProfit < 0) throw new Error('invalid_minimum_profit');
  if (reserve === null || reserve < 0 || fixed === null || fixed < 0 || customerShipping === null || customerShipping < 0 || advertisingCost === null || advertisingCost < 0 || cancellationReserve === null || cancellationReserve < 0 || !Number.isFinite(percent) || percent < 0 || percent >= 100 || !Number.isFinite(taxPercent) || taxPercent < 0 || !Number.isFinite(insurancePercent) || insurancePercent < 0 || taxPercent + insurancePercent >= 100 || !Number.isFinite(vatRate) || vatRate < 0 || !Number.isFinite(serviceFeeRate) || serviceFeeRate < 0 || !Number.isFinite(supplierBufferRate) || supplierBufferRate < 0) throw new Error('invalid_pricing_costs');
  const rate = percent / 100;
  const netRetentionRate = 1 - (taxPercent + insurancePercent) / 100;
  const preTaxProfitTarget = (minimumProfit + DEFAULT_PRICING_SAFETY_NET_ILS) / netRetentionRate;
  const collectedRetentionRate = (1 / (1 + vatRate)) - rate - serviceFeeRate;
  if (collectedRetentionRate <= 0) throw new Error('invalid_pricing_costs');
  const landedCost = productCost + customerShipping;
  const fixedCosts = landedCost + landedCost * supplierBufferRate + advertisingCost + cancellationReserve + reserve + fixed;
  const raw = (fixedCosts + preTaxProfitTarget) / collectedRetentionRate - customerShipping;
  const rounded = options.roundToWholeShekel === false ? Math.ceil(raw * 100) / 100 : Math.ceil(raw);
  return money(rounded);
}

function pricingForOffer(offer, minimumProfitIls, options = {}) {
  const normalized = normalizeOffer(offer);
  if (normalized.productPrice === null || normalized.shippingPrice === null) throw new Error('offer_cost_incomplete');
  const sellingPrice = requiredSellingPrice(normalized.productPrice, minimumProfitIls, { ...options, customerShippingIls: normalized.shippingPrice });
  const customerShipping = normalized.shippingPrice;
  const grossCollected = money(sellingPrice + customerShipping);
  const supplierCost = normalized.landedCost;
  const paymentFee = money(grossCollected * (Number(options.paymentFeePercent || 0) / 100) + Number(options.paymentFeeFixedIls || 0));
  const vat = money(grossCollected - grossCollected / (1 + Number(options.vatRate || 0)));
  const serviceFee = money(grossCollected * Number(options.serviceFeePercent || 0) / 100);
  const supplierBuffer = money(supplierCost * Number(options.supplierBufferPercent || 0) / 100);
  const advertisingCost = money(options.advertisingCostIls || 0);
  const cancellationReserve = money(options.cancellationReserveIls || 0);
  const reserve = money(options.reserveIls || 0);
  const preTaxProfit = money(grossCollected - vat - serviceFee - supplierCost - supplierBuffer - advertisingCost - cancellationReserve - paymentFee - reserve);
  const incomeTaxReserve = money(preTaxProfit * Number(options.taxReservePercent ?? DEFAULT_TAX_RESERVE_PERCENT) / 100);
  const insuranceReserve = money(preTaxProfit * Number(options.insuranceReservePercent ?? DEFAULT_INSURANCE_RESERVE_PERCENT) / 100);
  const projectedNetProfit = money(preTaxProfit - incomeTaxReserve - insuranceReserve);
  return { sellingPrice, customerShipping, grossCollected, supplierCost, supplierBuffer, vat, serviceFee, advertisingCost, cancellationReserve, paymentFee, reserve, preTaxProfit, incomeTaxReserve, insuranceReserve, projectedNetProfit };
}

module.exports = {
  DEFAULT_QUOTE_TTL_MS,
  DEFAULT_MINIMUM_PROFIT_ILS,
  DEFAULT_PRICING_SAFETY_NET_ILS,
  DEFAULT_TAX_RESERVE_PERCENT,
  DEFAULT_INSURANCE_RESERVE_PERCENT,
  AUTO_FULFILLMENT_PROVIDERS,
  normalizeOffer,
  offerBlockers,
  selectBestOffer,
  requiredSellingPrice,
  pricingForOffer
};
