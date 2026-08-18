const { requireAdmin, config, dbHeaders, audit } = require('../admin');
const { readPayPalRuntimeCredentials, normalizedPayPalEnvironment } = require('../provider-credentials');

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function paypalBaseUrl(environment) {
  return environment === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function validatePayPalCredentials(clientId, secret, environment) {
  const basic = Buffer.from(`${clientId}:${secret}`, 'utf8').toString('base64');
  let response;
  try {
    response = await fetch(`${paypalBaseUrl(environment)}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en_US',
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
  } catch {
    const error = new Error('paypal_validation_unreachable');
    error.status = 502;
    throw error;
  }

  const raw = await response.text();
  let json = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok || !json.access_token) {
    const error = new Error('paypal_credentials_invalid');
    error.status = response.status === 401 ? 400 : 502;
    throw error;
  }

  return {
    appId: clean(json.app_id, 120) || null,
    tokenType: clean(json.token_type, 40) || null,
    expiresIn: Number.isFinite(Number(json.expires_in)) ? Number(json.expires_in) : null
  };
}

async function saveCredentials(clientId, secret, environment) {
  const { supabaseUrl } = config();
  const response = await fetch(`${supabaseUrl}/rest/v1/server_provider_credentials?on_conflict=provider`, {
    method: 'POST',
    headers: dbHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    }),
    body: JSON.stringify({
      provider: 'paypal',
      client_id: clientId,
      client_secret: secret,
      environment,
      updated_at: new Date().toISOString()
    })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`paypal_credentials_save_${response.status}`);
  try { return raw ? JSON.parse(raw)[0] || null : null; } catch { return null; }
}

function publicStatus(runtime) {
  return {
    configured: runtime?.configured === true,
    environment: normalizedPayPalEnvironment(runtime?.environment),
    source: runtime?.source || 'none',
    updatedAt: runtime?.updatedAt || null,
    liveReady: runtime?.configured === true && normalizedPayPalEnvironment(runtime?.environment) === 'live'
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!await requireAdmin(req, res)) return;

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, ...publicStatus(await readPayPalRuntimeCredentials()) });
    }
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const environment = normalizedPayPalEnvironment(body.environment);
    const clientId = clean(body.clientId, 500);
    const secret = clean(body.secret, 500);
    if (clientId.length < 20 || secret.length < 20) {
      return res.status(400).json({ ok: false, error: 'paypal_credentials_incomplete' });
    }
    if (environment === 'live' && body.confirmLive !== true) {
      return res.status(400).json({ ok: false, error: 'paypal_live_confirmation_required' });
    }

    const verified = await validatePayPalCredentials(clientId, secret, environment);
    await saveCredentials(clientId, secret, environment);
    await audit('paypal_credentials_verified_and_saved', 'provider_credentials', 'paypal', {
      environment,
      appId: verified.appId,
      credentialValuesLogged: false
    });

    const runtime = await readPayPalRuntimeCredentials();
    return res.status(200).json({
      ok: true,
      verified: true,
      ...publicStatus(runtime),
      appId: verified.appId
    });
  } catch (error) {
    const code = clean(error.message || error, 160) || 'paypal_credentials_failed';
    console.error('PayPal credential setup failed:', code);
    const status = Number(error.status);
    return res.status(status >= 400 && status < 600 ? status : 500).json({ ok: false, error: code });
  }
};
