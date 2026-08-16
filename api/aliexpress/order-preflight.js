const crypto = require('crypto');
const { requireAdmin, audit, config, dbHeaders } = require('../_lib/admin');
const { getFulfillmentCandidate } = require('../_lib/fulfillment');
const { buildPlaceOrderRequest, safePreview } = require('../_lib/aliexpress-order');
const { quoteCartShipping } = require('../_lib/shipping');

async function recordPreparedAttempt(orderId, requestFingerprint) {
  const { supabaseUrl } = config();
  const response = await fetch(`${supabaseUrl}/rest/v1/supplier_order_attempts`, {
    method: 'POST',
    headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({
      order_id: orderId,
      request_fingerprint: requestFingerprint,
      status: 'prepared'
    })
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`attempt_journal_failed_${response.status}_${details.slice(0, 120)}`);
  }
  return (await response.json())[0] || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!await requireAdmin(req, res)) return;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const orderId = String(body.orderId || '').trim().toUpperCase();
    if (!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)) {
      return res.status(400).json({ ok: false, error: 'invalid_order_id' });
    }

    const { order, validation } = await getFulfillmentCandidate(orderId);
    if (!validation.ok) {
      await audit('supplier_order_preflight_blocked', 'order', orderId, {
        reason: validation.reason,
        productId: validation.productId || null
      });
      return res.status(409).json({ ok: false, error: 'preflight_blocked', validation });
    }

    const shippingLines = (Array.isArray(order.items) ? order.items : []).map((item) => ({
      id: String(item.id || ''),
      qty: Number(item.qty || 0),
      supplierProductId: item.supplierProductId,
      supplierShipFromCountry: item.supplierShipFromCountry || 'CN'
    }));
    const freshShipping = await quoteCartShipping(shippingLines, 'IL');
    const chargedShipping = Number(order.shipping_cost || 0);
    const currentShipping = Number(freshShipping.total || 0);
    if (!Number.isFinite(currentShipping) || currentShipping > chargedShipping + 0.01) {
      const shippingValidation = {
        ok: false,
        reason: 'supplier_shipping_price_increased',
        chargedShipping,
        currentShipping: Number.isFinite(currentShipping) ? currentShipping : null
      };
      await audit('supplier_order_preflight_blocked', 'order', orderId, shippingValidation);
      return res.status(409).json({ ok: false, error: 'preflight_blocked', validation: shippingValidation });
    }

    const request = buildPlaceOrderRequest(order, freshShipping);
    const requestFingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify(request), 'utf8')
      .digest('hex');
    const attempt = await recordPreparedAttempt(orderId, requestFingerprint);

    await audit('supplier_order_preflight_ready', 'order', orderId, {
      items: request.product_items.length,
      requestFingerprint,
      attemptId: attempt?.id || null,
      chargedShipping,
      currentShipping
    });

    return res.status(200).json({
      ok: true,
      dryRun: true,
      orderId,
      validation,
      requestFingerprint,
      attemptId: attempt?.id || null,
      chargedShipping,
      freshSupplierShipping: currentShipping,
      shippingCovered: currentShipping <= chargedShipping + 0.01,
      preview: safePreview(request),
      liveSupplierRequestSent: false,
      nextStep: 'supplier_place_order_endpoint_not_enabled'
    });
  } catch (error) {
    const message = String(error.message || error);
    console.error('supplier order preflight failed', message);
    return res.status(400).json({ ok: false, error: 'preflight_failed', detail: message.slice(0, 180) });
  }
};
