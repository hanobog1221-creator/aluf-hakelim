const { pricingPolicy } = require('./pricing-engine');
const {
  DEFAULT_MINIMUM_PROFIT_ILS,
  DEFAULT_TAX_RESERVE_PERCENT,
  DEFAULT_INSURANCE_RESERVE_PERCENT,
  AUTO_FULFILLMENT_PROVIDERS,
  pricingForOffer
} = require('./supplier-optimizer');

function providerOf(value) { return String(value || '').trim().toLowerCase(); }
function fresh(value, ttlMs, now) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time <= now + 60_000 && now - time <= ttlMs;
}

function pricingOptions(settings = {}) {
  const policy = pricingPolicy();
  return {
    paymentFeePercent: Math.max(policy.processingFeeRate * 100, Number(settings.pricing_fee_percent || 0)),
    paymentFeeFixedIls: Math.max(policy.processingFeeFixedIls, Number(settings.pricing_fee_fixed_ils || 0)),
    reserveIls: 0,
    taxReservePercent: Number(settings.pricing_tax_reserve_percent ?? DEFAULT_TAX_RESERVE_PERCENT),
    insuranceReservePercent: Number(settings.pricing_insurance_reserve_percent ?? DEFAULT_INSURANCE_RESERVE_PERCENT),
    vatRate: policy.vatRate,
    serviceFeePercent: policy.serviceFeeRate * 100,
    supplierBufferPercent: policy.supplierBufferRate * 100,
    advertisingCostIls: policy.advertisingCostIls,
    cancellationReserveIls: policy.cancellationRate * policy.refundFeeIls
  };
}

function productAutomationStatus(product, settings = {}, now = Date.now()) {
  const blockers = [];
  const provider = providerOf(product?.supplier || product?.fulfillment_provider);
  const ttlMinutes = Math.max(15, Math.min(1440, Number(settings.supplier_quote_ttl_minutes || 480)));
  const ttlMs = ttlMinutes * 60 * 1000;
  const configuredProfit = product?.minimum_profit == null ? Number(settings.minimum_profit_ils) : Number(product.minimum_profit);
  const minimumProfit = Math.max(DEFAULT_MINIMUM_PROFIT_ILS, Number.isFinite(configuredProfit) ? configuredProfit : DEFAULT_MINIMUM_PROFIT_ILS);

  if (product?.active !== true) blockers.push('product_inactive');
  if (product?.fulfillment_ready !== true) blockers.push('fulfillment_not_ready');
  if (!AUTO_FULFILLMENT_PROVIDERS.has(provider)) blockers.push('unsupported_supplier');
  if (!String(product?.supplier_product_id || '').trim()) blockers.push('supplier_product_id_missing');
  if (!String(product?.supplier_sku_id || '').trim()) blockers.push('supplier_sku_id_missing');
  if (provider === 'aliexpress' && !String(product?.supplier_sku_attr || '').trim()) blockers.push('supplier_sku_attr_missing');
  if (provider === 'cj' && (
    providerOf(product?.fulfillment_provider) !== 'cj' ||
    !product?.fulfillment_product_id || !product?.fulfillment_variant_id || !product?.fulfillment_sku || !product?.fulfillment_verified_at ||
    String(product.fulfillment_product_id) !== String(product.supplier_product_id || '') ||
    String(product.fulfillment_variant_id) !== String(product.supplier_sku_id || '')
  )) blockers.push('supplier_sku_not_verified');
  if (product?.supplier_in_stock !== true) blockers.push(product?.supplier_in_stock === false ? 'supplier_out_of_stock' : 'supplier_stock_unknown');
  if (product?.supplier_shipping_available !== true) blockers.push(product?.supplier_shipping_available === false ? 'supplier_shipping_unavailable' : 'supplier_shipping_unknown');
  if (!fresh(product?.last_sync_at, ttlMs, now)) blockers.push('supplier_product_sync_stale');
  if (!fresh(product?.shipping_last_checked_at, ttlMs, now)) blockers.push('supplier_shipping_sync_stale');
  if (product?.supplier_sync_error) blockers.push('supplier_sync_error');
  if (product?.shipping_sync_error) blockers.push('shipping_sync_error');

  const productCost = Number(product?.supplier_price_ils);
  const shippingCost = Number(product?.supplier_shipping);
  const sellingPrice = Number(product?.selling_price);
  if (!Number.isFinite(productCost) || productCost < 0) blockers.push('supplier_price_unknown');
  if (!Number.isFinite(shippingCost) || shippingCost < 0) blockers.push('supplier_shipping_unknown');
  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) blockers.push('selling_price_invalid');

  if (Number.isFinite(productCost) && Number.isFinite(shippingCost)) {
    const landedCost = Number((productCost + shippingCost).toFixed(2));
    const maxCost = product?.auto_fulfill_max_cost == null ? null : Number(product.auto_fulfill_max_cost);
    if (Number.isFinite(maxCost) && landedCost > maxCost) blockers.push('supplier_cost_above_auto_limit');
    try {
      const pricing = pricingForOffer(product, minimumProfit, pricingOptions(settings));
      if (!Number.isFinite(sellingPrice) || sellingPrice + 0.001 < pricing.sellingPrice || pricing.projectedNetProfit + 0.001 < minimumProfit) {
        blockers.push('minimum_net_profit_not_met');
      }
      return { ready: blockers.length === 0, blockers: [...new Set(blockers)], minimumProfit, pricing };
    } catch {
      blockers.push('pricing_calculation_failed');
    }
  }

  return { ready: false, blockers: [...new Set(blockers)], minimumProfit, pricing: null };
}

module.exports = { pricingOptions, productAutomationStatus };
