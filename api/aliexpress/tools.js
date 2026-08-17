const crypto = require('crypto');
const { requireAdmin } = require('../_lib/admin');
const { serverHeaders } = require('../_lib/supabase-server');

const CALLBACK_URL = 'https://aluf-hakelim-v2-ready.vercel.app/api/aliexpress/callback';
const APP_KEY = process.env.ALIEXPRESS_APP_KEY || '542860';
const TOKEN_PATH = '/auth/token/create';

function signedState() {
  const secret = process.env.ALIEXPRESS_APP_SECRET;
  if (!secret) throw new Error('aliexpress_app_secret_missing');
  const nonce = crypto.randomBytes(24).toString('hex');
  const signature = crypto.createHmac('sha256', secret).update(nonce, 'utf8').digest('hex');
  return `${nonce}.${signature}`;
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const found = raw.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

function signAliExpress(params, appSecret, apiPath) {
  const keys = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== null && String(params[key]) !== '')
    .sort();
  let payload = apiPath;
  for (const key of keys) payload += key + String(params[key]);
  return crypto.createHmac('sha256', appSecret).update(payload, 'utf8').digest('hex').toUpperCase();
}

function validSignedState(value, secret) {
  const state = String(value || '');
  const parts = state.split('.');
  if (parts.length !== 2 || !/^[a-f0-9]{48}$/i.test(parts[0]) || !/^[a-f0-9]{64}$/i.test(parts[1])) return false;
  const expected = crypto.createHmac('sha256', secret).update(parts[0], 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parts[1].toLowerCase(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

function allowedAliExpressUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'aliexpress.com' || host.endsWith('.aliexpress.com'));
  } catch {
    return false;
  }
}

async function resolveAliExpressUrl(startUrl) {
  let current = new URL(startUrl).toString();
  for (let i = 0; i < 6; i += 1) {
    if (!allowedAliExpressUrl(current)) throw new Error('redirect_outside_aliexpress');
    const response = await fetch(current, {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0' }
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { finalUrl: current, status: response.status };
    }
    const location = response.headers.get('location');
    if (!location) throw new Error('redirect_missing_location');
    const next = new URL(location, current).toString();
    if (!allowedAliExpressUrl(next)) throw new Error('redirect_outside_aliexpress');
    current = next;
  }
  throw new Error('too_many_redirects');
}

async function handleConnect(req, res) {
  if (!await requireAdmin(req, res)) return;
  try {
    const state = signedState();
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `ae_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: APP_KEY,
      redirect_uri: CALLBACK_URL,
      state,
      force_auth: 'true'
    });
    return res.redirect(`https://api-sg.aliexpress.com/oauth/authorize?${params.toString()}`);
  } catch (error) {
    console.error('AliExpress OAuth start failed', error);
    return res.status(500).send('AliExpress connection is not configured.');
  }
}

async function handleCallback(req, res) {
  const { code, state, error } = req.query || {};
  if (error) return res.status(400).send('AliExpress authorization failed.');
  if (!code) return res.status(400).send('Missing authorization code.');

  const appSecret = process.env.ALIEXPRESS_APP_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!appSecret) return res.status(500).send('ALIEXPRESS_APP_SECRET is not configured.');
  if (!supabaseUrl || !serviceKey) return res.status(500).send('Supabase server credentials are not configured.');

  const expectedState = getCookie(req, 'ae_oauth_state');
  if (!expectedState || !state || String(state) !== expectedState || !validSignedState(state, appSecret)) {
    return res.status(400).send('Invalid OAuth state. Please start the connection again from the admin panel.');
  }

  const params = {
    app_key: APP_KEY,
    code: String(code),
    sign_method: 'sha256',
    timestamp: String(Date.now())
  };
  params.sign = signAliExpress(params, appSecret, TOKEN_PATH);

  const tokenResponse = await fetch(`https://api-sg.aliexpress.com/rest${TOKEN_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params).toString()
  });

  const tokenText = await tokenResponse.text();
  let token;
  try { token = JSON.parse(tokenText); } catch { token = null; }

  if (!tokenResponse.ok || !token || !token.access_token || (token.code && String(token.code) !== '0')) {
    console.error('AliExpress token exchange failed', tokenResponse.status, tokenText.slice(0, 1000));
    return res.status(502).send('AliExpress token exchange failed.');
  }

  const now = Date.now();
  const expiresAt = token.expires_in ? new Date(now + Number(token.expires_in) * 1000).toISOString() : null;
  const refreshSeconds = token.refresh_expires_in || token.re_expires_in;
  const refreshExpiresAt = refreshSeconds ? new Date(now + Number(refreshSeconds) * 1000).toISOString() : null;

  const row = {
    account_key: 'primary',
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    token_type: token.token_type || 'Bearer',
    expires_at: expiresAt,
    refresh_expires_at: refreshExpiresAt,
    user_id: token.user_id ? String(token.user_id) : (token.seller_id ? String(token.seller_id) : null),
    user_nick: token.user_nick ? String(token.user_nick) : (token.account ? String(token.account) : null),
    raw: safeTokenMetadata(token),
    updated_at: new Date(now).toISOString()
  };

  const dbResponse = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/aliexpress_tokens?on_conflict=account_key`, {
    method: 'POST',
    headers: serverHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }, serviceKey),
    body: JSON.stringify(row)
  });

  if (!dbResponse.ok) {
    const details = await dbResponse.text();
    console.error('AliExpress token storage failed', dbResponse.status, details.slice(0, 500));
    return res.status(500).send('Authorization succeeded, but token storage failed.');
  }

  res.setHeader('Set-Cookie', 'ae_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial;background:#0b1118;color:white;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center"><h1>✅ AliExpress מחובר</h1><p>ההרשאה נשמרה בהצלחה. אפשר לסגור את החלון ולחזור לאתר.</p></div></body></html>`);
}

async function handleResolve(req, res) {
  if (!await requireAdmin(req, res)) return;
  const url = String(req.query?.url || '').trim();
  if (!/^https:\/\/a\.aliexpress\.com\//i.test(url) || !allowedAliExpressUrl(url)) {
    return res.status(400).json({ ok: false, error: 'invalid_aliexpress_short_url' });
  }

  try {
    const { finalUrl, status } = await resolveAliExpressUrl(url);
    const match = finalUrl.match(/(?:item\/|product\/)(\d+)\.html/i) || finalUrl.match(/[?&]productId=(\d+)/i);
    return res.status(200).json({ ok: true, finalUrl, productId: match ? match[1] : null, status });
  } catch (error) {
    console.error('AliExpress short link resolve failed', error);
    const code = String(error.message || error);
    if (code === 'redirect_outside_aliexpress') return res.status(400).json({ ok: false, error: 'unsafe_redirect' });
    if (code === 'too_many_redirects') return res.status(400).json({ ok: false, error: 'too_many_redirects' });
    return res.status(500).json({ ok: false, error: 'resolve_failed' });
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const action = String(req.query?.action || '').trim();
  if (action === 'connect') return handleConnect(req, res);
  if (action === 'callback') return handleCallback(req, res);
  if (action === 'resolve') return handleResolve(req, res);
  return res.status(400).json({ ok: false, error: 'invalid_aliexpress_action' });
};
