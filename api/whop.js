const { serverConfig, serverHeaders } = require('./_lib/supabase-server');
const { whopConfig } = require('./_lib/whop-security');
const { checkOrderPaymentReadiness } = require('./_lib/payment-readiness');

function clean(value, max = 300) { return String(value ?? '').trim().slice(0, max); }
function amountString(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) throw new Error('invalid_order_amount');
  return amount.toFixed(2);
}
function requestOrigin(req) {
  const proto = clean(String(req.headers['x-forwarded-proto'] || 'https').split(',')[0], 10).toLowerCase();
  const host = clean(String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0], 300);
  if (!['http', 'https'].includes(proto) || !host || !/^[A-Za-z0-9.-]+(?::\d+)?$/.test(host)) throw new Error('invalid_request_host');
  return `${proto}://${host}`;
}
function safePurchaseUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'whop.com' || host.endsWith('.whop.com')) ? url.toString() : null;
  } catch { return null; }
}
async function readOrder(orderId) {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=order_id,status,payment_status,payment_provider,payment_reference,currency,total,shipping_cost,items&limit=1`, { headers: serverHeaders() });
  if (!response.ok) throw new Error(`order_read_${response.status}`);
  return (await response.json())[0] || null;
}
async function whopRequest(cfg, path, options = {}) {
  const response = await fetch(`${cfg.baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const raw = await response.text();
  let json = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { json = {}; }
  if (!response.ok) {
    const message = clean(json?.error?.message || json?.message || `http_${response.status}`, 180);
    const error = new Error(`whop_${message}`);
    error.status = response.status;
    throw error;
  }
  return json;
}
async function markPaymentPending(orderId, checkoutId) {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: serverHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ status: 'payment_pending', payment_provider: 'whop', payment_reference: checkoutId, last_error: null, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`order_payment_pending_${response.status}`);
}
async function checkoutResponse(cfg, checkout, orderId) {
  const checkoutId = clean(checkout?.id, 120);
  const purchaseUrl = safePurchaseUrl(checkout?.purchase_url);
  if (!/^ch_[A-Za-z0-9]+$/.test(checkoutId) || !purchaseUrl) throw new Error('whop_checkout_response_invalid');
  return { ok: true, provider: 'whop', orderId, checkoutId, approveUrl: purchaseUrl, environment: 'live' };
}
async function handleCreate(req, res, body) {
  const orderId = clean(body.orderId, 80).toUpperCase();
  if (!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)) return res.status(400).json({ ok: false, error: 'invalid_order_id' });
  const cfg = whopConfig();
  const order = await readOrder(orderId);
  if (!order) return res.status(404).json({ ok: false, error: 'order_not_found' });
  if (order.payment_status === 'paid') return res.status(409).json({ ok: false, error: 'order_already_paid' });
  if (order.payment_provider && order.payment_provider !== 'whop') return res.status(409).json({ ok: false, error: 'payment_provider_mismatch' });

  if (order.payment_provider === 'whop' && /^ch_[A-Za-z0-9]+$/.test(clean(order.payment_reference, 120))) {
    const existing = await whopRequest(cfg, `/checkout_configurations/${encodeURIComponent(order.payment_reference)}`);
    return res.status(200).json(await checkoutResponse(cfg, existing, orderId));
  }

  const readiness = await checkOrderPaymentReadiness(orderId);
  if (!readiness?.ok) return res.status(409).json({ ok: false, error: readiness?.reason || 'order_not_payable', readiness });
  if (clean(readiness.currency, 3).toUpperCase() !== cfg.currency) return res.status(409).json({ ok: false, error: 'currency_mismatch' });
  const amount = amountString(readiness.amount);
  const returnUrl = `${requestOrigin(req)}/?whop=return&storeOrderId=${encodeURIComponent(orderId)}`;
  const checkout = await whopRequest(cfg, '/checkout_configurations', {
    method: 'POST',
    body: {
      company_id: cfg.companyId,
      mode: 'payment',
      plan: { initial_price: Number(amount), currency: cfg.currency.toLowerCase(), plan_type: 'one_time' },
      metadata: { order_id: orderId, amount, currency: cfg.currency },
      redirect_url: returnUrl,
      allow_promo_codes: false
    }
  });
  const output = await checkoutResponse(cfg, checkout, orderId);
  await markPaymentPending(orderId, output.checkoutId);
  return res.status(200).json(output);
}
async function handleStatus(res, orderIdValue) {
  const orderId = clean(orderIdValue, 80).toUpperCase();
  if (!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)) return res.status(400).json({ ok: false, error: 'invalid_order_id' });
  const order = await readOrder(orderId);
  if (!order) return res.status(404).json({ ok: false, error: 'order_not_found' });
  if (order.payment_provider && order.payment_provider !== 'whop') return res.status(409).json({ ok: false, error: 'payment_provider_mismatch' });
  return res.status(200).json({ ok: true, provider: 'whop', orderId, paymentStatus: order.payment_status, status: order.status });
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const action = clean(req.query?.action, 30);
    if (req.method === 'GET' && action === 'status') return handleStatus(res, req.query?.orderId);
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (action === 'create') return handleCreate(req, res, body);
    return res.status(400).json({ ok: false, error: 'invalid_action' });
  } catch (error) {
    console.error('Whop checkout failed:', error.message);
    const code = clean(error.message || error, 220);
    return res.status(error.status >= 400 && error.status < 600 ? error.status : 500).json({ ok: false, error: code || 'whop_failed' });
  }
};

module.exports._test = { amountString, safePurchaseUrl };
