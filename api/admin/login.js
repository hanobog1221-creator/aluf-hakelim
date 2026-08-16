const crypto = require('crypto');
const { verifyCredentials, createSession, setSessionCookie, audit, config, dbHeaders } = require('../_lib/admin');

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 8;

function requestIdentity(req, username) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const realIp = String(req.headers['x-real-ip'] || '').trim();
  const ip = forwarded || realIp || req.socket?.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(`${ip}|${String(username).toLowerCase()}`, 'utf8').digest('hex');
}

async function recentFailureCount(identityHash) {
  const { supabaseUrl } = config();
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/admin_login_attempts?identity_hash=eq.${encodeURIComponent(identityHash)}&failed_at=gte.${encodeURIComponent(since)}&select=id&limit=${LOGIN_FAILURE_LIMIT}`,
    { headers: dbHeaders() }
  );
  if (!response.ok) throw new Error(`login_attempts_read_${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows.length : 0;
}

async function recordFailure(identityHash) {
  const { supabaseUrl } = config();
  const response = await fetch(`${supabaseUrl}/rest/v1/admin_login_attempts`, {
    method: 'POST',
    headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ identity_hash: identityHash })
  });
  if (!response.ok) throw new Error(`login_attempt_write_${response.status}`);
}

async function clearFailures(identityHash) {
  const { supabaseUrl } = config();
  await fetch(`${supabaseUrl}/rest/v1/admin_login_attempts?identity_hash=eq.${encodeURIComponent(identityHash)}`, {
    method: 'DELETE',
    headers: dbHeaders()
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    if (!username || !password || username.length > 80 || password.length > 200) {
      return res.status(400).json({ ok: false, error: 'invalid_login' });
    }

    const identityHash = requestIdentity(req, username);
    const failures = await recentFailureCount(identityHash);
    if (failures >= LOGIN_FAILURE_LIMIT) {
      res.setHeader('Retry-After', String(Math.ceil(LOGIN_WINDOW_MS / 1000)));
      await audit('login_rate_limited', 'admin', username, {});
      return res.status(429).json({ ok: false, error: 'too_many_attempts' });
    }

    const valid = await verifyCredentials(username, password);
    if (!valid) {
      await recordFailure(identityHash);
      await new Promise((resolve) => setTimeout(resolve, 450));
      return res.status(401).json({ ok: false, error: 'invalid_login' });
    }

    await clearFailures(identityHash).catch(() => {});
    const session = await createSession();
    setSessionCookie(res, session.token);
    await audit('login', 'admin', username, {});
    return res.status(200).json({ ok: true, expiresAt: session.expiresAt });
  } catch (error) {
    console.error('admin login error', error);
    return res.status(500).json({ ok: false, error: 'login_failed' });
  }
};
