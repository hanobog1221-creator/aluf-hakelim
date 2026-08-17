const { requireAdmin, config, dbHeaders, audit } = require('../_lib/admin');
const { ensureAccessToken } = require('../_lib/cj');

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

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!await requireAdmin(req, res)) return;

  try {
    const configured = Boolean(String(process.env.CJ_API_KEY || '').trim());
    let connected = await readConnected();

    if (req.method === 'POST' && String(req.query?.test || '') === '1') {
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
