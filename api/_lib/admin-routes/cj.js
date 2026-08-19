const { requireAdmin, config, dbHeaders, audit } = require('../admin');
const { ensureAccessToken } = require('../cj');
const { readProviderCredentials } = require('../provider-credentials');

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

async function readConnected() {
  const { supabaseUrl } = config();
  const r = await fetch(`${supabaseUrl}/rest/v1/cj_tokens?id=eq.primary&select=access_token_expires_at&limit=1`, {
    headers: dbHeaders()
  });
  if (!r.ok) return false;
  const row = (await r.json())[0];
  if (!row?.access_token_expires_at) return false;
  const t = Date.parse(row.access_token_expires_at);
  return Number.isFinite(t) && t > Date.now() + 60 * 1000;
}

async function intakeCounts() {
  const { supabaseUrl } = config();
  const r = await fetch(`${supabaseUrl}/rest/v1/product_intake_jobs?select=status`, { headers: dbHeaders() });
  if (!r.ok) return {};
  const rows = await r.json();
  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
  return counts;
}

async function growCatalog() {
  const { supabaseUrl } = config();
  const tokenResponse = await fetch(`${supabaseUrl}/rest/v1/cj_worker_credentials?id=eq.primary&select=worker_token&limit=1`, { headers: dbHeaders() });
  if (!tokenResponse.ok) throw new Error(`cj_worker_token_read_${tokenResponse.status}`);
  const workerToken = String((await tokenResponse.json())[0]?.worker_token || '').trim();
  if (!workerToken) throw new Error('cj_worker_token_missing');
  const response = await fetch('https://aluf-hakelim-v2-ready.vercel.app/api/cj-worker-catalog?batch=2', {
    headers: { Accept: 'application/json', 'x-cj-worker-token': workerToken }
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) throw new Error(data?.error || `cj_catalog_worker_${response.status}`);
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!await requireAdmin(req, res)) return;

  try {
    const stored = await readProviderCredentials('cj').catch(() => null);
    const configured = Boolean(String(process.env.CJ_API_KEY || stored?.api_key || '').trim());
    let connected = await readConnected();

    if (req.method === 'POST' && String(req.query?.grow || '') === '1') {
      const catalog = await growCatalog();
      await audit('cj_catalog_grow', 'provider', 'cj', { added: catalog?.discovery?.added?.length || 0, rejected: catalog?.discovery?.rejected?.length || 0 });
      return res.status(200).json({ ok: true, catalog });
    } else if (req.method === 'POST' && String(req.query?.test || '') === '1') {
      await ensureAccessToken({ force: !connected });
      connected = true;
      await audit('cj_connection_test', 'provider', 'cj', { connected: true });
    } else if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    return res.status(200).json({
      ok: true,
      status: {
        configured,
        connected,
        sandbox: boolEnv('CJ_SANDBOX', true),
        autoPay: boolEnv('CJ_AUTO_PAY', false)
      },
      intake: await intakeCounts()
    });
  } catch (error) {
    console.error('CJ admin status failed:', error.message);
    return res.status(500).json({ ok: false, error: error.message || 'cj_status_failed' });
  }
};
