const { serverConfig, serverHeaders } = require('./supabase-server');

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
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

module.exports = { readProviderCredentials };
