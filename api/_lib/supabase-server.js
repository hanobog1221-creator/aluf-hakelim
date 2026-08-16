function serverKey() {
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!key) throw new Error('supabase_server_key_missing');
  return key;
}

function isOpaqueApiKey(key) {
  const value = String(key || '').trim();
  return value.startsWith('sb_secret_') || value.startsWith('sb_publishable_');
}

function serverHeaders(extra = {}, explicitKey = null) {
  const key = String(explicitKey || serverKey()).trim();
  const headers = {
    apikey: key,
    ...extra
  };

  // Legacy service_role keys are JWTs and may be used as the Bearer credential.
  // Modern sb_secret_* keys are opaque API keys and must not be treated as JWTs.
  if (!isOpaqueApiKey(key)) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

function serverConfig() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = serverKey();
  if (!supabaseUrl) throw new Error('supabase_url_missing');
  return { supabaseUrl, serviceKey: key };
}

module.exports = {
  serverKey,
  isOpaqueApiKey,
  serverHeaders,
  serverConfig
};
