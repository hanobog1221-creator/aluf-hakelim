const { serverConfig, serverHeaders } = require('./_lib/supabase-server');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const { supabaseUrl } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.ae-1005012832500138`, {
    method: 'PATCH',
    headers: serverHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ selling_price: 54.9, updated_at: new Date().toISOString() })
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) return res.status(502).json({ ok: false, status: response.status });
  const row = rows[0] || {};
  return res.status(200).json({ ok: true, id: row.id, sellingPrice: row.selling_price });
};
