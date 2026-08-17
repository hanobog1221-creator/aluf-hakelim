const { serverConfig, serverHeaders } = require('./_lib/supabase-server');

function clean(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
async function upsert(row) {
  const { supabaseUrl } = serverConfig();
  const r = await fetch(`${supabaseUrl}/rest/v1/server_provider_credentials?on_conflict=provider`, {
    method: 'POST',
    headers: serverHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }),
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() })
  });
  if (!r.ok) throw new Error(`credential_seed_${row.provider}_${r.status}`);
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.VERCEL_ENV !== 'preview') return res.status(403).json({ ok: false, error: 'preview_only' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  try {
    const paypalClientId = clean(process.env.PAYPAL_CLIENT_ID, 300);
    const paypalSecret = clean(process.env.PAYPAL_CLIENT_SECRET, 300);
    const paypalEnvironment = clean(process.env.PAYPAL_ENVIRONMENT || process.env.PAYPAL_ENV || 'sandbox', 20).toLowerCase() === 'live' ? 'live' : 'sandbox';
    const cjApiKey = clean(process.env.CJ_API_KEY, 500);
    if (!paypalClientId || !paypalSecret) throw new Error('preview_paypal_credentials_missing');
    if (!cjApiKey) throw new Error('preview_cj_api_key_missing');

    await upsert({ provider: 'paypal', client_id: paypalClientId, client_secret: paypalSecret, api_key: null, environment: paypalEnvironment });
    await upsert({ provider: 'cj', client_id: null, client_secret: null, api_key: cjApiKey, environment: null });
    return res.status(200).json({ ok: true, paypalSeeded: true, cjSeeded: true, paypalEnvironment });
  } catch (error) {
    console.error('Provider credential seed failed:', error.message);
    return res.status(500).json({ ok: false, error: clean(error.message, 220) });
  }
};
