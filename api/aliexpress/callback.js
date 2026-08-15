const CALLBACK_URL = 'https://aluf-hakelim-v2-ready.vercel.app/api/aliexpress/callback';
const APP_KEY = process.env.ALIEXPRESS_APP_KEY || '542860';

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const found = raw.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  const { code, state, error, error_description } = req.query || {};
  if (error) {
    return res.status(400).send(`AliExpress authorization failed: ${String(error_description || error)}`);
  }
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

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: APP_KEY,
    client_secret: appSecret,
    code: String(code),
    sp: 'ae',
    redirect_uri: CALLBACK_URL
  });

  const tokenResponse = await fetch('https://oauth.aliexpress.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  const tokenText = await tokenResponse.text();
  let token;
  try { token = JSON.parse(tokenText); } catch { token = null; }

  if (!tokenResponse.ok || !token || !token.access_token) {
    console.error('AliExpress token exchange failed', tokenResponse.status, tokenText);
    return res.status(502).send('AliExpress token exchange failed.');
  }

  const now = Date.now();
  const expiresAt = token.expires_in ? new Date(now + Number(token.expires_in) * 1000).toISOString() : null;
  const refreshExpiresAt = token.re_expires_in ? new Date(now + Number(token.re_expires_in) * 1000).toISOString() : null;

  const row = {
    account_key: 'primary',
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    token_type: token.token_type || 'Bearer',
    expires_at: expiresAt,
    refresh_expires_at: refreshExpiresAt,
    user_id: token.user_id ? String(token.user_id) : null,
    user_nick: token.user_nick ? String(token.user_nick) : null,
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
