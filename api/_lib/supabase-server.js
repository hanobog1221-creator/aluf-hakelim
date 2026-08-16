function configuredKey() {
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!key) throw new Error('supabase_server_key_missing');
  return key;
}

function isModernSecretKey(key) {
  return String(key || '').trim().startsWith('sb_secret_');
}

function isModernPublishableKey(key) {
  return String(key || '').trim().startsWith('sb_publishable_');
}

function jwtPayload(key) {
  const value = String(key || '').trim();
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function keyKind(key) {
  const value = String(key || '').trim();
  if (!value) return 'missing';
  if (isModernSecretKey(value)) return 'secret';
  if (isModernPublishableKey(value)) return 'publishable';
  const payload = jwtPayload(value);
  if (payload?.role === 'service_role') return 'legacy_service_role';
  if (payload?.role === 'anon') return 'legacy_anon';
  return 'unknown';
}

function apiKeyHeaders(extra = {}, explicitKey = null) {
  const key = String(explicitKey || configuredKey()).trim();
  const headers = { apikey: key, ...extra };
  const kind = keyKind(key);
  if (kind === 'legacy_service_role' || kind === 'legacy_anon') {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

function assertServerOnlyKey(key) {
  const kind = keyKind(key);
  if (kind === 'secret' || kind === 'legacy_service_role') return kind;
  if (kind === 'publishable' || kind === 'legacy_anon') {
    throw new Error('supabase_public_key_not_allowed_for_server');
  }
  throw new Error('supabase_unrecognized_server_key');
}

function serverKey() {
  const key = configuredKey();
  assertServerOnlyKey(key);
  return key;
}

function serverHeaders(extra = {}, explicitKey = null) {
  const key = String(explicitKey || configuredKey()).trim();
  assertServerOnlyKey(key);
  return apiKeyHeaders(extra, key);
}

function serverConfig() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = serverKey();
  if (!supabaseUrl) throw new Error('supabase_url_missing');
  return { supabaseUrl, serviceKey: key };
}

module.exports = {
  configuredKey,
  keyKind,
  apiKeyHeaders,
  assertServerOnlyKey,
  serverKey,
  serverHeaders,
  serverConfig
};
