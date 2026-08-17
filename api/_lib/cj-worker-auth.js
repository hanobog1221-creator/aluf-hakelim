const crypto = require('crypto');
const { serverConfig, serverHeaders } = require('./supabase-server');

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (!aa.length || aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

async function expectedWorkerToken() {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/cj_worker_credentials?id=eq.primary&select=worker_token&limit=1`, {
    headers: serverHeaders()
  });
  if (!response.ok) throw new Error(`cj_worker_token_read_${response.status}`);
  return String((await response.json())[0]?.worker_token || '').trim();
}

async function requireWorker(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return false;
  }
  const supplied = String(req.query?.token || '').trim();
  const expected = await expectedWorkerToken();
  if (!safeEqual(supplied, expected)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}

module.exports = { requireWorker };
