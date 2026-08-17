const crypto = require('crypto');
const { serverHeaders } = require('./supabase-server');

const APP_KEY = process.env.ALIEXPRESS_APP_KEY || '542860';
const API_BASE = 'https://api-sg.aliexpress.com/rest';
const TOP_API_BASE = 'https://api-sg.aliexpress.com/sync';
const REFRESH_PATH = '/auth/token/refresh';
const REFRESH_EARLY_MS = 30 * 60 * 1000;

function signAliExpress(params, appSecret, apiPath) {
  const keys = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== null && String(params[key]) !== '')
    .sort();
  let payload = apiPath;
  for (const key of keys) payload += key + String(params[key]);
  return crypto.createHmac('sha256', appSecret).update(payload, 'utf8').digest('hex').toUpperCase();
}

function formatTopTimestamp(date = new Date()) {
  return String(date.getTime());
}

function signTop(params, appSecret) {
  const payload = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => key + String(params[key]))
    .join('');
  return crypto.createHmac('sha256', appSecret).update(payload, 'utf8').digest('hex').toUpperCase();
}

function buildTopParams(method, businessParams, session, appSecret, date = new Date()) {
  const params = {
    method: String(method),
    app_key: APP_KEY,
    session: String(session),
    simplify: 'true',
    sign_method: 'sha256',
    timestamp: formatTopTimestamp(date)
  };
  for (const [key, value] of Object.entries(businessParams || {})) {
    if (value === undefined || value === null) continue;
    params[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  params.sign = signTop(params, appSecret);
  return params;
}

function safeTopError(json, status) {
  const error = json?.error_response || null;
  const code = error?.sub_code || error?.code || `top_http_${status}`;
  const message = error?.sub_msg || error?.msg || code;
  const err = new Error(String(code));
  err.code = String(code);
  err.details = String(message).slice(0, 500);
  return err;
}

async function executeTopApi(method, businessParams = {}, session = null) {
  const { appSecret } = getServerConfig();
  const params = buildTopParams(method, businessParams, session, appSecret);

  const response = await fetch(TOP_API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      accept: 'application/json'
    },
    body: new URLSearchParams(params).toString()
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!response.ok || !json || json.error_response) {
    const err = safeTopError(json, response.status);
    throw err;
  }
  return json;
}

async function callTopApi(method, businessParams = {}, options = {}) {
  const session = options.session === false ? null : await getValidAccessToken();
  return executeTopApi(method, businessParams, session);
}

function safeTokenMetadata(token) {
  return {
    code: token?.code ?? null,
    request_id: token?.request_id ?? null,
    expires_in: token?.expires_in ?? null,
    refresh_expires_in: token?.refresh_expires_in ?? token?.re_expires_in ?? null,
    token_type: token?.token_type ?? null,
    user_id: token?.user_id ?? token?.seller_id ?? null,
    user_nick: token?.user_nick ?? token?.account ?? null
  };
}

function getServerConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appSecret = process.env.ALIEXPRESS_APP_SECRET;
  if (!supabaseUrl || !serviceKey) throw new Error('supabase_server_credentials_missing');
  if (!appSecret) throw new Error('aliexpress_app_secret_missing');
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), serviceKey, appSecret };
}

async function readTokenRow() {
  const { supabaseUrl, serviceKey } = getServerConfig();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/aliexpress_tokens?account_key=eq.primary&select=*&limit=1`,
    { headers: serverHeaders({}, serviceKey) }
  );
  if (!response.ok) throw new Error(`token_read_${response.status}`);
  const rows = await response.json();
  if (!rows[0]?.access_token) throw new Error('missing_token');
  return rows[0];
}

async function saveTokenRow(existing, token) {
  const { supabaseUrl, serviceKey } = getServerConfig();
  const now = Date.now();
  const expiresAt = token.expires_in
    ? new Date(now + Number(token.expires_in) * 1000).toISOString()
    : existing.expires_at || null;

  let refreshExpiresAt = existing.refresh_expires_at || null;
  if (!refreshExpiresAt) {
    const refreshSeconds = token.refresh_expires_in || token.re_expires_in;
    if (refreshSeconds) refreshExpiresAt = new Date(now + Number(refreshSeconds) * 1000).toISOString();
  }

  const row = {
    account_key: 'primary',
    access_token: token.access_token,
    refresh_token: token.refresh_token || existing.refresh_token || null,
    token_type: token.token_type || existing.token_type || 'Bearer',
    expires_at: expiresAt,
    refresh_expires_at: refreshExpiresAt,
    user_id: token.user_id ? String(token.user_id) : (token.seller_id ? String(token.seller_id) : existing.user_id || null),
    user_nick: token.user_nick ? String(token.user_nick) : (token.account ? String(token.account) : existing.user_nick || null),
    raw: safeTokenMetadata(token),
    updated_at: new Date(now).toISOString()
  };

  const response = await fetch(`${supabaseUrl}/rest/v1/aliexpress_tokens?on_conflict=account_key`, {
    method: 'POST',
    headers: serverHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }, serviceKey),
    body: JSON.stringify(row)
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`token_save_${response.status}_${details.slice(0, 200)}`);
  }

  return row;
}

async function refreshAccessToken(existing) {
  const { appSecret } = getServerConfig();
  if (!existing.refresh_token) throw new Error('missing_refresh_token');

  if (existing.refresh_expires_at && Date.parse(existing.refresh_expires_at) <= Date.now()) {
    throw new Error('refresh_token_expired_reauthorize_required');
  }

  const params = {
    app_key: APP_KEY,
    refresh_token: String(existing.refresh_token),
    sign_method: 'sha256',
    timestamp: String(Date.now())
  };
  params.sign = signAliExpress(params, appSecret, REFRESH_PATH);

  const response = await fetch(`${API_BASE}${REFRESH_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params).toString()
  });

  const text = await response.text();
  let token;
  try { token = JSON.parse(text); } catch { token = null; }

  if (!response.ok || !token || !token.access_token || (token.code && String(token.code) !== '0')) {
    throw new Error(`token_refresh_failed_${response.status}_${text.slice(0, 300)}`);
  }

  return saveTokenRow(existing, token);
}

async function getValidAccessToken() {
  const row = await readTokenRow();
  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : null;
  const shouldRefresh = !expiresAt || expiresAt - Date.now() <= REFRESH_EARLY_MS;
  if (!shouldRefresh) return row.access_token;
  const refreshed = await refreshAccessToken(row);
  return refreshed.access_token;
}

module.exports = {
  APP_KEY,
  API_BASE,
  TOP_API_BASE,
  signAliExpress,
  signTop,
  buildTopParams,
  callTopApi,
  readTokenRow,
  refreshAccessToken,
  getValidAccessToken
};

