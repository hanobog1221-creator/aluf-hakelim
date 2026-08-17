const crypto = require('crypto');
const { requireAdmin, config, dbHeaders, audit } = require('../_lib/admin');
const { getFulfillmentCandidate } = require('../fulfillment');
const { quoteCartShipping } = require('../shipping');
const { buildPlaceOrderRequests, parsePlaceOrderResponse, safePreview } = require('../aliexpress-order');
const { callTopApi } = require('../aliexpress');
const { enabled } = require('../manual-aliexpress-fulfillment');

function clean(value, max = 300) { return String(value ?? '').trim().slice(0, max); }
function paymentUrl(orderId) { return `https://www.aliexpress.com/p/order/detail.html?orderId=${encodeURIComponent(orderId)}`; }
async function request(path, options = {}) {
  const { supabaseUrl } = config();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...options, headers: dbHeaders(options.headers || {}) });
  const raw = await response.text();
  if (!response.ok) throw new Error(`aliexpress_manual_db_${response.status}_${raw.slice(0, 160)}`);
  return raw ? JSON.parse(raw) : null;
}
async function patch(path, body) { return request(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body) }); }

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!await requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  try {
    if (!enabled()) return res.status(409).json({ ok: false, error: 'manual_aliexpress_fulfillment_disabled' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const orderId = clean(body.order_id, 80).toUpperCase();
    if (!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)) return res.status(400).json({ ok: false, error: 'invalid_order_id' });
    const existing = await request(`orders?order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`);
    const current = existing?.[0];
    if (!current) return res.status(404).json({ ok: false, error: 'order_not_found' });
    const existingIds = Array.isArray(current.supplier_order_ids) ? current.supplier_order_ids.map(String) : [];
    if (existingIds.length) return res.status(200).json({ ok: true, created: false, supplierOrderIds: existingIds, paymentUrl: paymentUrl(existingIds[0]) });
    if (current.payment_status !== 'paid') return res.status(409).json({ ok: false, error: 'order_not_paid' });

    const { order, validation } = await getFulfillmentCandidate(orderId);
    if (!validation.ok) return res.status(409).json({ ok: false, error: validation.reason || 'order_not_ready', validation });
    if ((order.items || []).some((item) => clean(item.supplier, 30).toLowerCase() !== 'aliexpress')) return res.status(409).json({ ok: false, error: 'non_aliexpress_order' });
    const lines = order.items.map((item) => ({ id: String(item.id || ''), qty: Number(item.qty || 0), supplierProductId: item.supplierProductId, supplierSkuId: item.supplierSkuId, supplierShipFromCountry: item.supplierShipFromCountry || 'CN' }));
    const shipping = await quoteCartShipping(lines, 'IL');
    if (Number(shipping.total || 0) > Number(order.shipping_cost || 0) + 0.01) return res.status(409).json({ ok: false, error: 'supplier_shipping_price_increased' });
    const groups = buildPlaceOrderRequests(order, shipping);
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(groups.map((group) => group.request)), 'utf8').digest('hex');
    const attempts = await request(`supplier_order_attempts?order_id=eq.${encodeURIComponent(orderId)}&status=in.(sending,created,payment_pending,paid,ambiguous)&select=*&limit=1`);
    if (attempts?.length) return res.status(409).json({ ok: false, error: 'supplier_attempt_already_exists' });
    const inserted = await request('supplier_order_attempts', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ order_id: orderId, request_fingerprint: fingerprint, status: 'sending', provider: 'aliexpress', provider_payment_required: true, provider_payment_completed: false, response: { previews: groups.map((group) => ({ supplierId: group.supplierId, request: safePreview(group.request) })) } }) });
    const attempt = inserted?.[0];
    const ids = [];
    try {
      for (const group of groups) {
        const json = await callTopApi('aliexpress.trade.buy.placeorder', { param_place_order_request4_open_api_d_t_o: group.request });
        const parsed = parsePlaceOrderResponse(json);
        if (parsed.outcome !== 'created') throw Object.assign(new Error(parsed.errorCode || parsed.outcome), { ambiguous: parsed.shouldReconcile, parsed });
        ids.push(...parsed.orderIds);
      }
    } catch (error) {
      await patch(`supplier_order_attempts?id=eq.${attempt.id}`, { status: error.ambiguous || ids.length ? 'ambiguous' : 'failed', supplier_order_ids: ids, error_code: clean(error.message, 120), error_message: clean(error.parsed?.errorMessage || error.message, 500) });
      return res.status(409).json({ ok: false, error: error.ambiguous || ids.length ? 'supplier_order_requires_reconciliation' : 'supplier_order_create_failed' });
    }
    const uniqueIds = [...new Set(ids)];
    await patch(`supplier_order_attempts?id=eq.${attempt.id}`, { status: 'payment_pending', supplier_order_ids: uniqueIds, provider_payment_required: true, provider_payment_completed: false });
    await patch(`orders?order_id=eq.${encodeURIComponent(orderId)}`, { supplier_order_id: uniqueIds[0], supplier_order_ids: uniqueIds, status: 'processing', fulfillment_status: 'ordering', last_error: 'manual_supplier_payment_required', updated_at: new Date().toISOString() });
    await audit('aliexpress_manual_order_create', 'order', orderId, { supplierOrderIds: uniqueIds, attemptId: attempt.id });
    return res.status(200).json({ ok: true, created: true, supplierOrderIds: uniqueIds, paymentUrl: paymentUrl(uniqueIds[0]) });
  } catch (error) {
    console.error('AliExpress manual order creation failed', error.message);
    return res.status(500).json({ ok: false, error: 'aliexpress_manual_order_failed' });
  }
};

