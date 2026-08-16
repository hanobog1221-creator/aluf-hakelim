const { requireAdmin, config, dbHeaders } = require('../_lib/admin');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!await requireAdmin(req, res)) return;

  try {
    const { supabaseUrl } = config();
    const orderId = String(req.query?.orderId || '').trim().toUpperCase();
    const limitRaw = Number(req.query?.limit || 100);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 100;

    if (orderId && !/^AH-[A-Z0-9-]{5,60}$/.test(orderId)) {
      return res.status(400).json({ ok: false, error: 'invalid_order_id' });
    }

    const filter = orderId ? `&order_id=eq.${encodeURIComponent(orderId)}` : '';
    const response = await fetch(
      `${supabaseUrl}/rest/v1/supplier_order_attempts?select=id,order_id,attempt_key,request_fingerprint,status,supplier_order_ids,error_code,error_message,created_at,updated_at${filter}&order=created_at.desc&limit=${limit}`,
      { headers: dbHeaders() }
    );
    if (!response.ok) throw new Error(`supplier_attempts_read_${response.status}`);

    const attempts = await response.json();
    return res.status(200).json({
      ok: true,
      attempts: attempts.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        attemptKey: row.attempt_key,
        requestFingerprint: row.request_fingerprint,
        status: row.status,
        supplierOrderIds: Array.isArray(row.supplier_order_ids) ? row.supplier_order_ids : [],
        errorCode: row.error_code || null,
        errorMessage: row.error_message ? String(row.error_message).slice(0, 300) : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    console.error('supplier attempts read failed', error);
    return res.status(500).json({ ok: false, error: 'supplier_attempts_failed' });
  }
};
