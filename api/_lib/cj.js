const { serverConfig, serverHeaders } = require('./supabase-server');

const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
const TOKEN_ID = 'primary';

function cleanString(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function dateValid(value, skewMs = 5 * 60 * 1000) {
  if (!value) return false;
  const t = Date.parse(value);
  return Number.isFinite(t) && t > Date.now() + skewMs;
}

async function readTokenRow() {
  const { supabaseUrl } = serverConfig();
  const r = await fetch(`${supabaseUrl}/rest/v1/cj_tokens?id=eq.${TOKEN_ID}&select=*&limit=1`, {
    headers: serverHeaders()
  });
  if (!r.ok) throw new Error(`cj_token_read_${r.status}`);
  return (await r.json())[0] || null;
}

async function saveTokenData(data) {
  const accessToken = cleanString(data?.accessToken);
  if (!accessToken) throw new Error('cj_access_token_missing');

  const row = {
    id: TOKEN_ID,
    access_token: accessToken,
    refresh_token: cleanString(data?.refreshToken) || null,
    access_token_expires_at: cleanString(data?.accessTokenExpiryDate) || null,
    refresh_token_expires_at: cleanString(data?.refreshTokenExpiryDate) || null,
    open_id: data?.openId === null || data?.openId === undefined ? null : String(data.openId),
    updated_at: new Date().toISOString()
  };

  const { supabaseUrl } = serverConfig();
  const r = await fetch(`${supabaseUrl}/rest/v1/cj_tokens?on_conflict=id`, {
    method: 'POST',
    headers: serverHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }),
    body: JSON.stringify(row)
  });
  if (!r.ok) throw new Error(`cj_token_save_${r.status}`);
  return row;
}

function cjSuccess(json) {
  if (!json || typeof json !== 'object') return false;
  if (json.success === false || json.result === false) return false;
  const code = Number(json.code);
  if (Number.isFinite(code) && ![0, 200].includes(code)) return false;
  return true;
}

async function cjRequest(path, { method = 'GET', token = '', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers['CJ-Access-Token'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const r = await fetch(`${CJ_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text.slice(0, 300) }; }

  if (!r.ok || !cjSuccess(json)) {
    const message = cleanString(json?.message) || `http_${r.status}`;
    const code = json?.code === undefined ? '' : String(json.code);
    const error = new Error(`cj_api_${code || r.status}_${message}`.slice(0, 300));
    error.status = r.status;
    error.cj = json;
    throw error;
  }
  return json;
}

async function tokenFromApiKey() {
  const apiKey = cleanString(process.env.CJ_API_KEY);
  if (!apiKey) throw new Error('cj_api_key_missing');
  const json = await cjRequest('/authentication/getAccessToken', {
    method: 'POST',
    body: { apiKey }
  });
  await saveTokenData(json.data || {});
  return cleanString(json.data?.accessToken);
}

async function tokenFromRefresh(refreshToken) {
  const json = await cjRequest('/authentication/refreshAccessToken', {
    method: 'POST',
    body: { refreshToken }
  });
  await saveTokenData(json.data || {});
  return cleanString(json.data?.accessToken);
}

async function ensureAccessToken({ force = false } = {}) {
  let row = null;
  try { row = await readTokenRow(); } catch (error) {
    if (!force) throw error;
  }

  if (!force && row?.access_token && dateValid(row.access_token_expires_at)) {
    return row.access_token;
  }

  if (row?.refresh_token && dateValid(row.refresh_token_expires_at, 60 * 1000)) {
    try {
      return await tokenFromRefresh(row.refresh_token);
    } catch (error) {
      console.warn('CJ refresh token failed:', error.message);
    }
  }

  return tokenFromApiKey();
}

async function createSourcing(payload) {
  const token = await ensureAccessToken();
  return cjRequest('/product/sourcing/create', {
    method: 'POST',
    token,
    body: payload
  });
}

async function querySourcing(sourceIds) {
  const token = await ensureAccessToken();
  return cjRequest('/product/sourcing/query', {
    method: 'POST',
    token,
    body: { sourceIds }
  });
}

module.exports = {
  CJ_BASE,
  ensureAccessToken,
  createSourcing,
  querySourcing
};
