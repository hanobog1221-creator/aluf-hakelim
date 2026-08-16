const crypto = require('crypto');
const { requireAdmin, audit } = require('../_lib/admin');
const { getFulfillmentCandidate } = require('../_lib/fulfillment');
const { buildPlaceOrderRequest, safePreview } = require('../_lib/aliexpress-order');

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

    const request = buildPlaceOrderRequest(order);
    const requestFingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify(request), 'utf8')
      .digest('hex');

    await audit('supplier_order_preflight_ready', 'order', orderId, {
      items: request.product_items.length,
      requestFingerprint
    });

    return res.status(200).json({
      ok: true,
      dryRun: true,
      orderId,
      validation,
      requestFingerprint,
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
