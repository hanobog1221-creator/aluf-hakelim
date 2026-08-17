const { requireAdmin, config, dbHeaders, audit } = require('../_lib/admin');
const { refreshAliExpressTracking, isAliExpressOrder } = require('../aliexpress-tracking');

function looksShipped(logisticsStatus) {
  return /(SEND_GOODS|SHIPPED|IN_TRANSIT|DELIVER)/i.test(String(logisticsStatus || ''));
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!await requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const orderId = String(body.order_id || '').trim().toUpperCase();
    if (!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)) return res.status(400).json({ ok: false, error: 'invalid_order_id' });

    const { supabaseUrl } = config();
    const read = await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`, {
      headers: dbHeaders()
    });
    if (!read.ok) throw new Error(`order_read_${read.status}`);
    const order = (await read.json())[0] || null;
    if (!order) return res.status(404).json({ ok: false, error: 'order_not_found' });
    if (!isAliExpressOrder(order)) return res.status(409).json({ ok: false, error: 'not_aliexpress_order' });

    const sync = await refreshAliExpressTracking(order, { force: true });
    if (sync.skipped) {
      return res.status(200).json({ ok: true, synced: false, reason: sync.reason, trackingNumbers: order.tracking_numbers || [] });
    }

    const now = new Date().toISOString();
    const update = { updated_at: now };
    if (Array.isArray(sync.trackingNumbers) && sync.trackingNumbers.length) {
      update.tracking_number = sync.trackingNumber || order.tracking_number || null;
      update.tracking_numbers = sync.trackingNumbers;
      if (looksShipped(sync.logisticsStatus) && !['completed', 'cancelled'].includes(String(order.status || '')) && !['delivered', 'cancelled'].includes(String(order.fulfillment_status || ''))) {
        update.status = 'shipped';
        update.fulfillment_status = 'shipped';
      }
    }

    const write = await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify(update)
    });
    if (!write.ok) throw new Error(`tracking_update_${write.status}`);

    await audit('aliexpress_tracking_refresh', 'order', orderId, {
      trackingCount: Array.isArray(sync.trackingNumbers) ? sync.trackingNumbers.length : 0,
      pickupPointDetected: Boolean(sync.pickupPoint)
    });

    return res.status(200).json({
      ok: true,
      synced: true,
      trackingNumber: sync.trackingNumber || null,
      trackingNumbers: sync.trackingNumbers || [],
      pickupPoint: sync.pickupPoint || null,
      logisticsStatus: sync.logisticsStatus || null
    });
  } catch (error) {
    console.error('AliExpress admin tracking refresh failed:', error.code || error.message);
    return res.status(500).json({ ok: false, error: 'aliexpress_tracking_refresh_failed' });
  }
};
