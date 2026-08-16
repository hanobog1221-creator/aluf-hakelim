const { requireAdmin, config, dbHeaders, audit } = require('../_lib/admin');

const ORDER_STATUSES = new Set(['draft','payment_pending','paid','processing','ordered','shipped','completed','cancelled','error']);
const FULFILLMENT_STATUSES = new Set(['not_started','waiting','ready','ordering','ordered','shipped','delivered','failed','cancelled']);

function text(value, max) {
  if (value === null || value === undefined || value === '') return null;
  const out = String(value).trim();
  if (out.length > max) throw new Error('text_too_long');
  return out || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!await requireAdmin(req, res)) return;

  try {
    const { supabaseUrl } = config();

    if (req.method === 'GET') {
      const limitRaw = Number(req.query?.limit || 100);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 100;
      const response = await fetch(`${supabaseUrl}/rest/v1/orders?select=*&order=created_at.desc&limit=${limit}`, {
        headers: dbHeaders()
      });
      if (!response.ok) throw new Error(`orders_read_${response.status}`);
      const orders = await response.json();
      return res.status(200).json({ ok: true, orders });
    }

    if (req.method === 'PATCH') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const orderId = String(body.order_id || '').trim();
      if (!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)) return res.status(400).json({ ok: false, error: 'invalid_order_id' });

      const update = {};
      if ('status' in body) {
        const status = String(body.status || '');
        if (!ORDER_STATUSES.has(status)) return res.status(400).json({ ok: false, error: 'invalid_status' });
        update.status = status;
      }
      if ('fulfillment_status' in body) {
        const status = String(body.fulfillment_status || '');
        if (!FULFILLMENT_STATUSES.has(status)) return res.status(400).json({ ok: false, error: 'invalid_fulfillment_status' });
        update.fulfillment_status = status;
      }
      if ('supplier_order_id' in body) update.supplier_order_id = text(body.supplier_order_id, 120);
      if ('tracking_number' in body) update.tracking_number = text(body.tracking_number, 160);
      if ('last_error' in body) update.last_error = text(body.last_error, 1200);

      if (!Object.keys(update).length) return res.status(400).json({ ok: false, error: 'no_changes' });
      update.updated_at = new Date().toISOString();

      const response = await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify(update)
      });
      if (!response.ok) {
        const details = await response.text();
        throw new Error(`order_update_${response.status}_${details.slice(0, 200)}`);
      }
      const order = (await response.json())[0] || null;
      if (!order) return res.status(404).json({ ok: false, error: 'order_not_found' });
      await audit('order_update', 'order', orderId, { fields: Object.keys(update) });
      return res.status(200).json({ ok: true, order });
    }

    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (error) {
    console.error('admin orders error', error);
    return res.status(500).json({ ok: false, error: 'admin_orders_failed' });
  }
};
