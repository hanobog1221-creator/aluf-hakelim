const crypto = require('crypto');

const SESSION_COOKIE = 'ah_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function config() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('admin_server_config_missing');
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), serviceKey };
}

function dbHeaders(extra = {}) {
  const { serviceKey } = config();
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...extra
  };
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const cookies = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return cookies;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function passwordHash(password, saltBase64) {
  const salt = Buffer.from(saltBase64, 'base64');
  return crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64');
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

async function verifyCredentials(username, password) {
  const { supabaseUrl } = config();
  const response = await fetch(`${supabaseUrl}/rest/v1/admin_credentials?username=eq.${encodeURIComponent(String(username))}&select=username,password_salt,password_hash&limit=1`, {
    headers: dbHeaders()
  });
  if (!response.ok) throw new Error(`admin_credentials_read_${response.status}`);
  const rows = await response.json();
  const row = rows[0];
  if (!row) return false;
  const candidate = passwordHash(password, row.password_salt);
  return safeEqual(candidate, row.password_hash);
}

async function createSession() {
  const { supabaseUrl } = config();
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = tokenHash(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const response = await fetch(`${supabaseUrl}/rest/v1/admin_sessions`, {
    method: 'POST',
    headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ token_hash: hash, expires_at: expiresAt })
  });
  if (!response.ok) throw new Error(`admin_session_create_${response.status}`);
  return { token, expiresAt };
}

async function deleteSession(token) {
  if (!token) return;
  const { supabaseUrl } = config();
  await fetch(`${supabaseUrl}/rest/v1/admin_sessions?token_hash=eq.${tokenHash(token)}`, {
    method: 'DELETE',
    headers: dbHeaders()
  });
}

async function requireAdmin(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }

  const { supabaseUrl } = config();
  const response = await fetch(`${supabaseUrl}/rest/v1/admin_sessions?token_hash=eq.${tokenHash(token)}&select=expires_at&limit=1`, {
    headers: dbHeaders()
  });
  if (!response.ok) {
    res.status(500).json({ ok: false, error: 'admin_auth_failed' });
    return false;
  }
  const rows = await response.json();
  const expiresAt = rows[0]?.expires_at;
  if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
    await deleteSession(token).catch(() => {});
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}

async function audit(action, entityType, entityId, details = {}) {
  try {
    const { supabaseUrl } = config();
    await fetch(`${supabaseUrl}/rest/v1/admin_audit_log`, {
      method: 'POST',
      headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({
        action: String(action),
        entity_type: entityType ? String(entityType) : null,
        entity_id: entityId ? String(entityId) : null,
        details
      })
    });
  } catch (error) {
    console.error('admin audit failed', error);
  }
}

module.exports = {
  SESSION_COOKIE,
  config,
  dbHeaders,
  parseCookies,
  verifyCredentials,
  createSession,
  deleteSession,
  requireAdmin,
  setSessionCookie,
  audit
};
