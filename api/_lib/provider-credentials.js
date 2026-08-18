const { serverConfig, serverHeaders } = require('./supabase-server');

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizedPayPalEnvironment(value) {
  return clean(value || 'sandbox', 20).toLowerCase() === 'live' ? 'live' : 'sandbox';
}

async function readProviderCredentials(provider) {
  const name = clean(provider, 30).toLowerCase();
  if (!['paypal', 'cj'].includes(name)) throw new Error('invalid_provider_credentials_key');
  const { supabaseUrl } = serverConfig();
  const r = await fetch(`${supabaseUrl}/rest/v1/server_provider_credentials?provider=eq.${encodeURIComponent(name)}&select=provider,client_id,client_secret,api_key,environment,updated_at&limit=1`, {
    headers: serverHeaders()
  });
  if (!r.ok) throw new Error(`provider_credentials_read_${r.status}`);
  return (await r.json())[0] || null;
}

function choosePayPalCredentials(stored, env = process.env) {
  const storedClientId = clean(stored?.client_id, 500);
  const storedSecret = clean(stored?.client_secret, 500);
  if (storedClientId && storedSecret) {
    return {
      configured: true,
      clientId: storedClientId,
      secret: storedSecret,
      environment: normalizedPayPalEnvironment(stored?.environment),
      source: 'stored',
      updatedAt: stored?.updated_at || null
    };
  }

  const envClientId = clean(env?.PAYPAL_CLIENT_ID, 500);
  const envSecret = clean(env?.PAYPAL_CLIENT_SECRET, 500);
  return {
    configured: Boolean(envClientId && envSecret),
    clientId: envClientId,
    secret: envSecret,
    environment: normalizedPayPalEnvironment(env?.PAYPAL_ENVIRONMENT || env?.PAYPAL_ENV || 'sandbox'),
    source: envClientId && envSecret ? 'environment' : 'none',
    updatedAt: null
  };
}

async function readPayPalRuntimeCredentials() {
  const stored = await readProviderCredentials('paypal').catch(() => null);
  return choosePayPalCredentials(stored, process.env);
}

module.exports = {
  readProviderCredentials,
  normalizedPayPalEnvironment,
  choosePayPalCredentials,
  readPayPalRuntimeCredentials
};
