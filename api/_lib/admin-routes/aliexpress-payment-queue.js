const { requireAdmin, config, dbHeaders, audit } = require('../admin');
const { fulfillAliExpressOrder } = require('../aliexpress-fulfillment');
const { callTopApi } = require('../aliexpress');
const { parseOrderDetailResponse } = require('../aliexpress-tracking');

function clean(value, max = 300) { return String(value ?? '').trim().slice(0, max); }
function paymentUrl(orderId) { return `https://www.aliexpress.com/p/order/detail.html?orderId=${encodeURIComponent(orderId)}`; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function supplierIds(order) {
  const ids = [];
  for (const raw of asArray(order?.supplier_order_ids)) {
    const id = clean(raw, 40);
    if (/^\d{5,30}$/.test(id) && !ids.includes(id)) ids.push(id);
  }
  const first = clean(order?.supplier_order_id, 40);
  if (/^\d{5,30}$/.test(first) && !ids.includes(first)) ids.unshift(first);
  return ids;
}
function isAliExpressOrder(order) {
  const items = asArray(order?.items);
  return items.length > 0 && items.every((item) => clean(item?.fulfillmentProvider || item?.supplier, 30).toLowerCase() === 'aliexpress');
}
function customerPaid(order) {
  const total = Number(order?.total || 0);
  const shipping = Number(order?.shipping_cost || 0);
  return Number(((Number.isFinite(total) ? total : 0) + (Number.isFinite(shipping) ? shipping : 0)).toFixed(2));
}
function paymentConfirmedByOrderStatus(status) {
  const value = clean(status, 80).toUpperCase();
  return new Set([
    'PAYMENT_PROCESSING',
    'RISK_CONTROL',
    'RISK_CONTROL_HOLD',
    'WAIT_SELLER_SEND_GOODS',
    'SELLER_PART_SEND_GOODS',
    'WAIT_BUYER_ACCEPT_GOODS',
    'FUND_PROCESSING',
    'IN_ISSUE',
    'IN_FROZEN',
    'FINISH'
  ]).has(value);
}

async function db(path, options = {}) {
  const { supabaseUrl } = config();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: dbHeaders(options.headers || {})
  });
  const raw = await response.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) throw new Error(`aliexpress_payment_queue_db_${response.status}`);
  return json;
}
async function patch(path, body) {
  return db(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
}

async function listQueue() {
  const [orders, attempts] = await Promise.all([
    db('orders?payment_status=eq.paid&select=order_id,status,payment_status,fulfillment_status,total,shipping_cost,currency,items,customer,customer_note,admin_note,supplier_order_id,supplier_order_ids,last_error,paid_at,created_at,updated_at,tracking_number,tracking_numbers&order=created_at.desc&limit=100'),
    db('supplier_order_attempts?provider=eq.aliexpress&select=id,order_id,status,supplier_order_ids,provider_payment_required,provider_payment_completed,provider_cost,provider_currency,error_code,error_message,created_at,updated_at&order=created_at.desc&limit=200')
  ]);
  const latestAttempt = new Map();
  for (const attempt of attempts || []) if (!latestAttempt.has(String(attempt.order_id))) latestAttempt.set(String(attempt.order_id), attempt);

  const rows = [];
  for (const order of orders || []) {
    if (!isAliExpressOrder(order)) continue;
    const attempt = latestAttempt.get(String(order.order_id)) || null;
    const ids = supplierIds(order);
    const paymentCompleted = attempt?.provider_payment_completed === true || attempt?.status === 'paid';
    const needsSupplierOrder = !ids.length;
    const needsPayment = ids.length > 0 && !paymentCompleted;
    const needsReview = attempt?.status === 'ambiguous' || attempt?.status === 'failed';
    if (!needsSupplierOrder && !needsPayment && !needsReview && !['manual_supplier_payment_required','supplier_autopay_confirmation_pending','supplier_payment_confirmation_pending'].includes(String(order.last_error || ''))) continue;
    rows.push({
      orderId: order.order_id,
      createdAt: order.created_at,
      paidAt: order.paid_at,
      updatedAt: order.updated_at,
      currency: clean(order.currency || 'ILS', 3).toUpperCase(),
      customerPaid: customerPaid(order),
      customer: order.customer || {},
      customerNote: order.customer_note || order.customer?.notes || null,
      items: asArray(order.items).map((item) => ({
        id: clean(item?.id, 120),
        name: clean(item?.name, 240),
        qty: Number(item?.qty || 0),
        variant: clean(item?.variant, 180) || null,
        supplierProductId: clean(item?.supplierProductId, 80) || null,
        supplierSkuId: clean(item?.supplierSkuId, 120) || null
      })),
      supplierOrderIds: ids,
      paymentLinks: ids.map((id) => ({ supplierOrderId: id, url: paymentUrl(id) })),
      fulfillmentStatus: order.fulfillment_status,
      lastError: order.last_error,
      attempt: attempt ? {
        id: attempt.id,
        status: attempt.status,
        providerPaymentRequired: attempt.provider_payment_required === true,
        providerPaymentCompleted: attempt.provider_payment_completed === true,
        providerCost: attempt.provider_cost === null ? null : Number(attempt.provider_cost),
        providerCurrency: attempt.provider_currency || null,
        errorCode: attempt.error_code || null,
        errorMessage: attempt.error_message || null,
        updatedAt: attempt.updated_at
      } : null,
      action: needsReview ? 'review' : needsSupplierOrder ? 'create_supplier_order' : needsPayment ? 'pay_supplier' : 'verify_payment'
    });
  }
  return rows;
}

async function verifyPayment(orderId) {
  const orders = await db(`orders?order_id=eq.${encodeURIComponent(orderId)}&select=order_id,items,supplier_order_id,supplier_order_ids&limit=1`);
  const order = orders?.[0];
  if (!order) throw Object.assign(new Error('order_not_found'), { status: 404 });
  if (!isAliExpressOrder(order)) throw Object.assign(new Error('non_aliexpress_order'), { status: 409 });
  const ids = supplierIds(order);
  if (!ids.length) throw Object.assign(new Error('supplier_order_missing'), { status: 409 });

  const details = [];
  for (const supplierOrderId of ids) {
    const json = await callTopApi('aliexpress.trade.ds.order.get', {
      single_order_query: { order_id: Number(supplierOrderId) }
    });
    const parsed = parseOrderDetailResponse(json);
    details.push({
      supplierOrderId,
      orderStatus: parsed.orderStatus || null,
      logisticsStatus: parsed.logisticsStatus || null,
      paid: paymentConfirmedByOrderStatus(parsed.orderStatus)
    });
  }
  const allPaid = details.length > 0 && details.every((row) => row.paid);
  if (!allPaid) return { verified: false, details };

  const attempts = await db(`supplier_order_attempts?order_id=eq.${encodeURIComponent(orderId)}&provider=eq.aliexpress&order=created_at.desc&limit=1&select=id,status`);
  const attempt = attempts?.[0] || null;
  if (attempt?.id) {
    await patch(`supplier_order_attempts?id=eq.${encodeURIComponent(attempt.id)}`, {
      status: 'paid',
      provider_payment_required: true,
      provider_payment_completed: true,
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString()
    });
  }
  await patch(`orders?order_id=eq.${encodeURIComponent(orderId)}`, {
    status: 'processing',
    fulfillment_status: 'waiting',
    last_error: null,
    updated_at: new Date().toISOString()
  });
  await audit('aliexpress_manual_payment_verified', 'order', orderId, { supplierOrderIds: ids, statuses: details.map((row) => row.orderStatus) });
  return { verified: true, details };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!await requireAdmin(req, res)) return;

  try {
    if (req.method === 'GET') {
      const rows = await listQueue();
      return res.status(200).json({ ok: true, count: rows.length, rows });
    }
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const orderId = clean(body.orderId, 80).toUpperCase();
    if (!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)) return res.status(400).json({ ok: false, error: 'invalid_order_id' });
    const action = clean(body.action, 40).toLowerCase();

    if (action === 'create_supplier_order') {
      const result = await fulfillAliExpressOrder(orderId);
      return res.status(result?.ok ? 200 : 409).json({ ok: result?.ok === true, result, rows: await listQueue() });
    }
    if (action === 'verify_payment') {
      const result = await verifyPayment(orderId);
      return res.status(200).json({ ok: true, ...result, rows: await listQueue() });
    }
    return res.status(400).json({ ok: false, error: 'invalid_action' });
  } catch (error) {
    console.error('AliExpress payment queue failed:', error.message);
    const status = Number(error.status);
    return res.status(status >= 400 && status < 600 ? status : 500).json({ ok: false, error: clean(error.message || error, 200) || 'aliexpress_payment_queue_failed' });
  }
};
