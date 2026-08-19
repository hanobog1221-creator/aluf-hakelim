const { requireAdmin, config, dbHeaders, audit } = require('../admin');
const { CONNECTOR_IDS, connectorDefinition, publicConnectorStatus } = require('../supplier-connectors');
const { ensureAccessToken } = require('../cj');
const { runCjSandboxVerification } = require('../cj-sandbox-verification');

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
      const rows = await dbJson(`${supabaseUrl}/rest/v1/supplier_connector_credentials?select=provider,enabled,api_key,client_id,client_secret,api_verified,order_verified,last_error,metadata,updated_at`, { headers: dbHeaders() });
      const byProvider = new Map((rows || []).map((row) => [row.provider, row]));
      return res.status(200).json({ ok: true, connectors: CONNECTOR_IDS.map((id) => publicConnectorStatus(byProvider.get(id), id)) });
    }
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const provider = clean(body.provider, 40).toLowerCase();
    const definition = connectorDefinition(provider);
    if (!definition) return res.status(400).json({ ok: false, error: 'unsupported_supplier_connector' });
    if (clean(body.action, 30).toLowerCase() === 'verify_sandbox') {
      if (!definition.sandboxVerificationSupported || provider !== 'cj') return res.status(409).json({ ok: false, error: 'supplier_sandbox_verification_not_supported' });
      const mappedProducts = await dbJson(`${supabaseUrl}/rest/v1/products?fulfillment_provider=eq.cj&fulfillment_variant_id=not.is.null&select=fulfillment_variant_id&order=fulfillment_verified_at.desc.nullslast&limit=5`, { headers: dbHeaders() }).catch(() => []);
      const result = await runCjSandboxVerification({ preferredVids: (mappedProducts || []).map((row) => clean(row.fulfillment_variant_id, 160)).filter(Boolean) });
      const verifiedAt = new Date().toISOString();
      const metadata = {
        verification_mode: 'sandbox', live_order_verified: false, charged: false,
        sandbox_order_id: result.orderId, sandbox_tracking_number: result.trackingNumber,
        product: result.product, shipping: result.shipping, verified_at: verifiedAt
      };
      const verified = await dbJson(`${supabaseUrl}/rest/v1/supplier_connector_credentials?provider=eq.${encodeURIComponent(provider)}`, {
        method: 'PATCH',
        headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify({ order_verified: true, order_verified_at: verifiedAt, enabled: false, last_error: null, metadata, updated_at: verifiedAt })
      });
      await audit('supplier_connector_sandbox_verified', 'supplier_connector', provider, { charged: false, realFulfillmentCreated: false, product: result.product, shipping: result.shipping });
      return res.status(200).json({ ok: true, connector: publicConnectorStatus(verified?.[0] || { metadata }, provider), verification: result });
    }
    if (clean(body.action, 30).toLowerCase() === 'verify') {
      if (!definition.apiVerificationSupported) return res.status(409).json({ ok: false, error: 'supplier_api_verification_requires_provider_documentation' });
      if (provider === 'cj') await ensureAccessToken({ force: true });
      const verifiedAt = new Date().toISOString();
      const verified = await dbJson(`${supabaseUrl}/rest/v1/supplier_connector_credentials?provider=eq.${encodeURIComponent(provider)}`, {
        method: 'PATCH',
        headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify({ api_verified: true, api_verified_at: verifiedAt, enabled: false, last_error: 'real_order_test_required', updated_at: verifiedAt })
      });
      await audit('supplier_connector_api_verified', 'supplier_connector', provider, { orderTestStillRequired: true });
      return res.status(200).json({ ok: true, connector: publicConnectorStatus(verified?.[0] || {}, provider) });
    }
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
    if (provider === 'cj') {
      await dbJson(`${supabaseUrl}/rest/v1/server_provider_credentials?on_conflict=provider`, {
        method: 'POST',
        headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({ provider: 'cj', api_key: apiKey, client_id: null, client_secret: null, environment: 'live', updated_at: row.updated_at })
      });
    }
    await audit('supplier_connector_credentials_saved', 'supplier_connector', provider, { credentialValuesLogged: false, activationBlockedUntilOrderTest: true });
    return res.status(200).json({ ok: true, connector: publicConnectorStatus(saved?.[0] || row, provider) });
  } catch (error) {
    console.error('supplier connectors failed:', error.message);
    return res.status(500).json({ ok: false, error: clean(error.message, 220) || 'supplier_connectors_failed' });
  }
};
