const crypto = require('crypto');
const { getFulfillmentCandidate } = require('./fulfillment');
const { quoteCartShipping } = require('./shipping');
const { buildPlaceOrderRequests, safePreview } = require('./aliexpress-order');

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function aliExpressCreateEnabled() {
  return boolEnv('ALIEXPRESS_ORDER_CREATE_ENABLED', false);
}

function aliExpressAutoPayAuthorized() {
  // Keep this false unless AliExpress explicitly grants an order-payment API
  // compatible with aliexpress.trade.buy.placeorder for this buyer account.
  return boolEnv('ALIEXPRESS_AUTO_PAY_AUTHORIZED', false);
}

async function preflightAliExpressOrder(orderId) {
  const { order, validation } = await getFulfillmentCandidate(orderId);
  if (!validation.ok) return { ok: false, skipped: true, validation, liveSupplierRequestSent: false };

  const nonAliExpress = (Array.isArray(order.items) ? order.items : [])
    .find((item) => String(item?.supplier || '').trim().toLowerCase() !== 'aliexpress');
  if (nonAliExpress) {
    return { ok: false, skipped: true, reason: 'mixed_or_non_aliexpress_order', liveSupplierRequestSent: false };
  }

  const shippingLines = order.items.map((item) => ({
    id: String(item.id || ''),
    qty: Number(item.qty || 0),
    supplierProductId: item.supplierProductId,
    supplierSkuId: item.supplierSkuId,
    supplierShipFromCountry: item.supplierShipFromCountry || 'CN'
  }));
  const freshShipping = await quoteCartShipping(shippingLines, 'IL');
  const chargedShipping = Number(order.shipping_cost || 0);
  const currentShipping = Number(freshShipping.total || 0);
  if (!Number.isFinite(currentShipping) || currentShipping > chargedShipping + 0.01) {
    return {
      ok: false,
      skipped: true,
      reason: 'supplier_shipping_price_increased',
      chargedShipping,
      currentShipping: Number.isFinite(currentShipping) ? currentShipping : null,
      liveSupplierRequestSent: false
    };
  }

  const groups = buildPlaceOrderRequests(order, freshShipping);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(groups.map((g) => g.request)), 'utf8').digest('hex');
  const createEnabled = aliExpressCreateEnabled();
  const autoPayAuthorized = aliExpressAutoPayAuthorized();

  return {
    ok: createEnabled && autoPayAuthorized,
    skipped: !(createEnabled && autoPayAuthorized),
    reason: !createEnabled
      ? 'aliexpress_order_creation_disabled'
      : (!autoPayAuthorized ? 'aliexpress_automatic_payment_authorization_required' : null),
    provider: 'aliexpress',
    requestFingerprint: fingerprint,
    chargedShipping,
    currentShipping,
    supplierOrders: groups.map((group) => ({ supplierId: group.supplierId, preview: safePreview(group.request) })),
    liveSupplierRequestSent: false,
    supplierPaymentSent: false
  };
}

module.exports = {
  aliExpressCreateEnabled,
  aliExpressAutoPayAuthorized,
  preflightAliExpressOrder
};
