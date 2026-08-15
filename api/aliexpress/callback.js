const crypto = require('crypto');

const APP_KEY = process.env.ALIEXPRESS_APP_KEY || '542860';
const TOKEN_PATH = '/auth/token/create';

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const found = raw.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

function signAliExpress(params, appSecret, apiPath) {
  const keys = Object.keys(params).filter(k => k !== 'sign' && params[k] !== undefined && params[k] !== null && String(params[k]) !== '').sort();
  let payload = apiPath;
  for (const key of keys) payload += key + String(params[key]);
  return crypto.createHmac('sha256', appSecret).update(payload, 'utf8').digest('hex').toUpperCase();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  const { code, state, error, error_description } = req.query || {};
  if (error) return res.status(400).send(`AliExpress authorization failed: ${String(error_description || error)}`);
  if (!code) return res.status(400).send('Missing authorization code.');

  const expectedState = getCookie(req, 'ae_oauth_state');
  if (!expectedState || !state || state !== expectedState) {
    return res.status(400).send('Invalid OAuth state. Please start the connection again.');
  }

  const appSecret = process.env.ALIEXPRESS_APP_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!appSecret) return res.status(500).send('ALIEXPRESS_APP_SECRET is not configured.');
  if (!supabaseUrl || !serviceKey) return res.status(500).send('Supabase server credentials are not configured.');

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

  if (!tokenResponse.ok || !token || !token.access_token || token.code && String(token.code) !== '0') {
    console.error('AliExpress token exchange failed', tokenResponse.status, tokenText);
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
    raw: token,
    updated_at: new Date().toISOString()
  };

  const dbResponse = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/aliexpress_tokens?on_conflict=account_key`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(row)
  });

  if (!dbResponse.ok) {
    const details = await dbResponse.text();
    console.error('AliExpress token storage failed', dbResponse.status, details);
    return res.status(500).send('Authorization succeeded, but token storage failed.');
  }

  res.setHeader('Set-Cookie', 'ae_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial;background:#0b1118;color:white;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center"><h1>✅ AliExpress מחובר</h1><p>ההרשאה נשמרה בהצלחה. אפשר לסגור את החלון ולחזור לאתר.</p></div></body></html>`);
};
