const crypto = require('crypto');
const { serverConfig, serverHeaders } = require('./supabase-server');
const { readProviderCredentials } = require('./provider-credentials');

function clean(value, max = 300) { return String(value ?? '').trim().slice(0, max); }
function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('invalid_money');
  return Number(n.toFixed(2));
}
function isSandboxOrder(orderId) { return /^AH-SBX-PAY-[A-Z0-9-]{5,60}$/i.test(String(orderId || '')); }
function paypalEnvironment(value) { return clean(value || 'sandbox', 20).toLowerCase() === 'live' ? 'live' : 'sandbox'; }

async function paypalConfig() {
  const stored = await readProviderCredentials('paypal').catch(() => null);
  const clientId = clean(process.env.PAYPAL_CLIENT_ID || stored?.client_id, 500);
  const secret = clean(process.env.PAYPAL_CLIENT_SECRET || stored?.client_secret, 500);
  const environment = paypalEnvironment(process.env.PAYPAL_ENVIRONMENT || process.env.PAYPAL_ENV || stored?.environment || 'sandbox');
  if (!clientId || !secret) throw new Error('paypal_not_configured');
  return {
    clientId,
    secret,
    environment,
    baseUrl: environment === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
  };
}

async function paypalToken(cfg) {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.secret}`, 'utf8').toString('base64');
  const response = await fetch(`${cfg.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en_US',
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const raw = await response.text();
  let json = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok || !json.access_token) throw new Error(`paypal_auth_${response.status}`);
  return json.access_token;
}

async function paypalRequest(cfg, path, { method = 'GET', body, requestId } = {}) {
  const token = await paypalToken(cfg);
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  if (requestId) headers['PayPal-Request-Id'] = clean(requestId, 108);
  if (method === 'POST') headers.Prefer = 'return=representation';
  const response = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let json = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { json = { message: raw.slice(0, 300) }; }
  if (!response.ok) {
    const issue = json?.details?.[0]?.issue || json?.name || `http_${response.status}`;
    const error = new Error(`paypal_${issue}`.slice(0, 220));
    error.status = response.status;
    error.paypal = json;
    throw error;
  }
  return json;
}

async function readOrder(orderId) {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=order_id,status,payment_status,payment_provider,payment_reference,total,shipping_cost,currency,paid_at,refund_status,refund_amount,refunded_at,supplier_order_id,supplier_order_ids&limit=1`,
    { headers: serverHeaders() }
  );
  if (!response.ok) throw new Error(`refund_order_read_${response.status}`);
  return (await response.json())[0] || null;
}

async function completedRefundExpenses(orderId) {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/business_expenses?order_id=eq.${encodeURIComponent(orderId)}&category=eq.refund&source=eq.paypal_refund&select=amount,reference,source_key,expense_date,created_at&order=created_at.asc`,
    { headers: serverHeaders() }
  );
  if (!response.ok) throw new Error(`refund_expenses_read_${response.status}`);
  const rows = await response.json();
  const total = money(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  return { rows, total };
}

async function upsertPaymentEvent({ refund, orderId, environment }) {
  const { supabaseUrl } = serverConfig();
  const refundId = clean(refund?.id, 200);
  if (!refundId) throw new Error('paypal_refund_id_missing');
  const amount = refund?.amount || {};
  const row = {
    provider: 'paypal',
    provider_event_id: refundId,
    order_id: orderId,
    event_type: `refund_${clean(refund?.status || 'unknown', 30).toLowerCase()}`,
    verified: true,
    payload: {
      refundId,
      status: clean(refund?.status, 30).toUpperCase(),
      amount: clean(amount?.value, 40),
      currency: clean(amount?.currency_code, 3).toUpperCase(),
      environment
    },
    processed_at: new Date().toISOString(),
    processing_error: null
  };
  const response = await fetch(`${supabaseUrl}/rest/v1/payment_events?on_conflict=provider,provider_event_id`, {
    method: 'POST',
    headers: serverHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }),
    body: JSON.stringify(row)
  });
  if (!response.ok) throw new Error(`refund_event_write_${response.status}`);
}

async function upsertRefundExpense({ refund, orderId }) {
  const { supabaseUrl } = serverConfig();
  const refundId = clean(refund?.id, 200);
  const amount = money(refund?.amount?.value);
  const currency = clean(refund?.amount?.currency_code, 3).toUpperCase();
  if (!refundId || amount <= 0 || currency !== 'ILS') throw new Error('invalid_completed_refund');
  const completedAt = clean(refund?.update_time || refund?.create_time, 60);
  const date = Number.isFinite(Date.parse(completedAt)) ? new Date(completedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const row = {
    expense_date: date,
    category: 'refund',
    description: `PayPal refund ${orderId}`,
    amount,
    currency: 'ILS',
    reference: refundId,
    order_id: orderId,
    source: 'paypal_refund',
    source_key: refundId,
    updated_at: new Date().toISOString()
  };
  const response = await fetch(`${supabaseUrl}/rest/v1/business_expenses?on_conflict=source,source_key`, {
    method: 'POST',
    headers: serverHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }),
    body: JSON.stringify(row)
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`refund_expense_write_${response.status}_${details.slice(0, 160)}`);
  }
}

async function writeOrderEvent(orderId, eventType, payload) {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/order_events`, {
    method: 'POST',
    headers: serverHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ order_id: orderId, event_type: eventType, payload: payload || {} })
  });
  if (!response.ok) console.warn('Refund order event write failed', response.status);
}

async function patchOrderRefund(order, completedTotal, { pending = false } = {}) {
  const { supabaseUrl } = serverConfig();
  const gross = money(Number(order.total || 0) + Number(order.shipping_cost || 0));
  const total = money(Math.max(0, Math.min(gross, completedTotal)));
  let refundStatus = 'none';
  let paymentStatus = order.payment_status;
  let refundedAt = null;
  if (pending) {
    refundStatus = 'processing';
  } else if (total > 0 && total < gross) {
    refundStatus = 'partial';
    paymentStatus = 'paid';
    refundedAt = new Date().toISOString();
  } else if (gross > 0 && total >= gross) {
    refundStatus = 'refunded';
    paymentStatus = 'refunded';
    refundedAt = new Date().toISOString();
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(order.order_id)}`, {
    method: 'PATCH',
    headers: serverHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({
      refund_status: refundStatus,
      refund_amount: total,
      payment_status: paymentStatus,
      refunded_at: refundedAt,
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error(`refund_order_update_${response.status}`);
  return (await response.json())[0] || null;
}

function validateOrderForPayPalRefund(order, cfg) {
  if (!order) throw new Error('order_not_found');
  if (order.payment_provider !== 'paypal') throw new Error('order_not_paid_by_paypal');
  if (!order.paid_at || !['paid', 'refunded'].includes(String(order.payment_status || ''))) throw new Error('refund_requires_paid_order');
  if (clean(order.currency, 3).toUpperCase() !== 'ILS') throw new Error('refund_currency_mismatch');
  const captureId = clean(order.payment_reference, 200);
  if (!captureId || !/^[A-Z0-9]+$/i.test(captureId)) throw new Error('paypal_capture_reference_missing');
  if (isSandboxOrder(order.order_id) && cfg.environment !== 'sandbox') throw new Error('sandbox_refund_requires_paypal_sandbox');
  if (!isSandboxOrder(order.order_id) && cfg.environment !== 'live') throw new Error('live_refund_requires_paypal_live');
  return captureId;
}

function refundRequestId(orderId, captureId, completedBefore, amount) {
  const seed = `${orderId}|${captureId}|${Math.round(completedBefore * 100)}|${Math.round(amount * 100)}`;
  return `rf-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
}

async function finalizeCompletedRefund({ order, refund, environment }) {
  await upsertPaymentEvent({ refund, orderId: order.order_id, environment });
  await upsertRefundExpense({ refund, orderId: order.order_id });
  const completed = await completedRefundExpenses(order.order_id);
  const updatedOrder = await patchOrderRefund(order, completed.total);
  await writeOrderEvent(order.order_id, 'paypal_refund_completed', {
    refundId: clean(refund.id, 200),
    amount: money(refund.amount?.value),
    currency: clean(refund.amount?.currency_code, 3).toUpperCase(),
    totalRefunded: completed.total,
    refundStatus: updatedOrder?.refund_status || null,
    environment
  });
  return { completed, updatedOrder };
}

async function issuePayPalRefund(orderId, requestedAmount) {
  const id = clean(orderId, 80).toUpperCase();
  if (!/^AH-[A-Z0-9-]{5,60}$/.test(id)) throw new Error('invalid_order_id');
  const amount = money(requestedAmount);
  if (amount <= 0) throw new Error('invalid_refund_amount');

  const [cfg, order] = await Promise.all([paypalConfig(), readOrder(id)]);
  const captureId = validateOrderForPayPalRefund(order, cfg);
  const gross = money(Number(order.total || 0) + Number(order.shipping_cost || 0));
  const completedBefore = await completedRefundExpenses(id);
  const remaining = money(Math.max(0, gross - completedBefore.total));
  if (remaining <= 0) throw new Error('order_already_fully_refunded');
  if (amount > remaining) throw new Error('refund_amount_exceeds_remaining');

  const requestId = refundRequestId(id, captureId, completedBefore.total, amount);
  const fullFirstRefund = completedBefore.total === 0 && amount === gross;
  const body = fullFirstRefund ? {} : { amount: { value: amount.toFixed(2), currency_code: 'ILS' } };
  const refund = await paypalRequest(cfg, `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    method: 'POST',
    body,
    requestId
  });
  const status = clean(refund?.status, 30).toUpperCase();
  const refundAmount = money(refund?.amount?.value ?? amount);
  const refundCurrency = clean(refund?.amount?.currency_code || 'ILS', 3).toUpperCase();
  if (!refund?.id || refundCurrency !== 'ILS' || refundAmount !== amount) throw new Error('paypal_refund_response_mismatch');

  await upsertPaymentEvent({ refund, orderId: id, environment: cfg.environment });
  if (status === 'COMPLETED') {
    const finalized = await finalizeCompletedRefund({ order, refund, environment: cfg.environment });
    return {
      ok: true,
      orderId: id,
      refundId: clean(refund.id, 200),
      status,
      amount,
      currency: 'ILS',
      environment: cfg.environment,
      completedTotal: finalized.completed.total,
      remaining: money(Math.max(0, gross - finalized.completed.total)),
      order: finalized.updatedOrder,
      supplierCancellationRequired: Boolean(order.supplier_order_id || (Array.isArray(order.supplier_order_ids) && order.supplier_order_ids.length))
    };
  }

  if (status === 'PENDING') {
    const updatedOrder = await patchOrderRefund(order, completedBefore.total, { pending: true });
    await writeOrderEvent(id, 'paypal_refund_pending', {
      refundId: clean(refund.id, 200), amount, currency: 'ILS', environment: cfg.environment
    });
    return {
      ok: true,
      orderId: id,
      refundId: clean(refund.id, 200),
      status,
      amount,
      currency: 'ILS',
      environment: cfg.environment,
      completedTotal: completedBefore.total,
      remaining,
      order: updatedOrder,
      supplierCancellationRequired: Boolean(order.supplier_order_id || (Array.isArray(order.supplier_order_ids) && order.supplier_order_ids.length))
    };
  }

  throw new Error(`paypal_refund_${status || 'unknown'}`.toLowerCase());
}

async function syncPayPalRefund(orderId, refundId) {
  const id = clean(orderId, 80).toUpperCase();
  const rid = clean(refundId, 200);
  if (!/^AH-[A-Z0-9-]{5,60}$/.test(id) || !/^[A-Z0-9]+$/i.test(rid)) throw new Error('invalid_refund_sync_request');
  const [cfg, order] = await Promise.all([paypalConfig(), readOrder(id)]);
  validateOrderForPayPalRefund(order, cfg);
  const refund = await paypalRequest(cfg, `/v2/payments/refunds/${encodeURIComponent(rid)}`);
  if (clean(refund?.id, 200) !== rid) throw new Error('paypal_refund_id_mismatch');
  await upsertPaymentEvent({ refund, orderId: id, environment: cfg.environment });
  const status = clean(refund?.status, 30).toUpperCase();
  if (status === 'COMPLETED') {
    const finalized = await finalizeCompletedRefund({ order, refund, environment: cfg.environment });
    const gross = money(Number(order.total || 0) + Number(order.shipping_cost || 0));
    return { ok: true, orderId: id, refundId: rid, status, completedTotal: finalized.completed.total, remaining: money(Math.max(0, gross - finalized.completed.total)), order: finalized.updatedOrder };
  }
  if (status === 'PENDING') {
    const completed = await completedRefundExpenses(id);
    const updatedOrder = await patchOrderRefund(order, completed.total, { pending: true });
    return { ok: true, orderId: id, refundId: rid, status, completedTotal: completed.total, order: updatedOrder };
  }
  return { ok: false, orderId: id, refundId: rid, status, error: `paypal_refund_${status || 'unknown'}`.toLowerCase() };
}

module.exports = {
  issuePayPalRefund,
  syncPayPalRefund,
  completedRefundExpenses,
  paypalConfig
};
