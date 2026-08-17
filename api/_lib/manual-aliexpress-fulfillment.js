const { serverConfig, serverHeaders } = require('./supabase-server');

function clean(value, max = 300) { return String(value ?? '').trim().slice(0, max); }
function enabled() { return ['1', 'true', 'yes', 'on'].includes(clean(process.env.ALIEXPRESS_MANUAL_FULFILLMENT_ENABLED, 10).toLowerCase()); }

async function dbRequest(path, options = {}) {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...options, headers: serverHeaders(options.headers || {}) });
  if (!response.ok) throw new Error(`manual_fulfillment_db_${response.status}`);
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

async function queueManualAliExpressOrder(order, preflight) {
  if (!enabled()) return { ok: false, skipped: true, reason: 'aliexpress_manual_fulfillment_disabled' };
  const now = new Date().toISOString();
  const rows = await dbRequest(`orders?order_id=eq.${encodeURIComponent(order.order_id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'processing', fulfillment_status: 'waiting', last_error: 'manual_supplier_payment_required', updated_at: now })
  });
  if (!rows?.length) throw new Error('manual_fulfillment_order_not_updated');
  await dbRequest('order_events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      order_id: order.order_id,
      event_type: 'manual_supplier_payment_required',
      payload: { provider: 'aliexpress', requestFingerprint: preflight.requestFingerprint, chargedShipping: preflight.chargedShipping, currentShipping: preflight.currentShipping, supplierOrders: preflight.supplierOrders, queuedAt: now }
    })
  });
  return { ok: true, queued: true, provider: 'aliexpress', fulfillmentStatus: 'waiting', reason: 'manual_supplier_payment_required', notification: { storedInAdmin: true }, liveSupplierRequestSent: false, supplierPaymentSent: false };
}

module.exports = { enabled, queueManualAliExpressOrder };

