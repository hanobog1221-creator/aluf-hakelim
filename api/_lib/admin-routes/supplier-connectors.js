const { requireAdmin, config, dbHeaders, audit } = require('../admin');
const { CONNECTOR_IDS, connectorDefinition, publicConnectorStatus } = require('../supplier-connectors');

function clean(value, max = 500) { return String(value ?? '').trim().slice(0, max); }

async function dbJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) throw new Error(`supplier_connectors_db_${response.status}_${raw.slice(0, 160)}`);
  return json;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!await requireAdmin(req, res)) return;
  try {
    const { supabaseUrl } = config();
    if (req.method === 'GET') {
      const rows = await dbJson(`${supabaseUrl}/rest/v1/supplier_connector_credentials?select=provider,enabled,api_key,client_id,client_secret,api_verified,order_verified,last_error,updated_at`, { headers: dbHeaders() });
      const byProvider = new Map((rows || []).map((row) => [row.provider, row]));
      return res.status(200).json({ ok: true, connectors: CONNECTOR_IDS.map((id) => publicConnectorStatus(byProvider.get(id), id)) });
    }
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const provider = clean(body.provider, 40).toLowerCase();
    const definition = connectorDefinition(provider);
    if (!definition) return res.status(400).json({ ok: false, error: 'unsupported_supplier_connector' });
    const apiKey = clean(body.apiKey, 1000), clientId = clean(body.clientId, 500), clientSecret = clean(body.clientSecret, 1000);
    if (!apiKey && !(clientId && clientSecret)) return res.status(400).json({ ok: false, error: 'supplier_credentials_incomplete' });
    const row = {
      provider,
      api_key: apiKey || null,
      client_id: clientId || null,
      client_secret: clientSecret || null,
      base_url: clean(body.baseUrl, 500) || null,
      enabled: false,
      api_verified: false,
      order_verified: false,
      last_error: 'credentials_saved_pending_api_and_order_verification',
      updated_at: new Date().toISOString()
    };
    const saved = await dbJson(`${supabaseUrl}/rest/v1/supplier_connector_credentials?on_conflict=provider`, {
      method: 'POST',
      headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(row)
    });
    await audit('supplier_connector_credentials_saved', 'supplier_connector', provider, { credentialValuesLogged: false, activationBlockedUntilOrderTest: true });
    return res.status(200).json({ ok: true, connector: publicConnectorStatus(saved?.[0] || row, provider) });
  } catch (error) {
    console.error('supplier connectors failed:', error.message);
    return res.status(500).json({ ok: false, error: clean(error.message, 220) || 'supplier_connectors_failed' });
  }
};
