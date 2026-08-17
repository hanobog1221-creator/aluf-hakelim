const { serverConfig, serverHeaders } = require('../supabase-server');
const { ensureAccessToken, CJ_BASE } = require('../cj');
const { requireWorker } = require('../cj-worker-auth');

const PAID_STATUSES = new Set(['PENDING','PROCESSING','UNSHIPPED','SHIPPED','DELIVERED']);
const SHIPPED_STATUSES = new Set(['SHIPPED','DELIVERED']);
const MAX_ATTEMPTS = 12;
const MAX_PROVIDER_ORDERS = 20;

function clean(value, max = 300) { return String(value ?? '').trim().slice(0, max); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function dbGet(path) {
  const { supabaseUrl } = serverConfig();
  const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: serverHeaders() });
  if (!r.ok) throw new Error(`db_get_${r.status}`);
  return r.json();
}

async function patch(table, filter, data) {
  const { supabaseUrl } = serverConfig();
  const r = await fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: serverHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ ...data, updated_at: new Date().toISOString() })
  });
  if (!r.ok) throw new Error(`${table}_patch_${r.status}_${(await r.text()).slice(0, 180)}`);
  return (await r.json())[0] || null;
}

async function cjOrderDetail(orderId) {
  const token = await ensureAccessToken();
  const r = await fetch(`${CJ_BASE}/shopping/order/getOrderDetail?orderId=${encodeURIComponent(orderId)}&features=LOGISTICS_TIMELINESS`, {
    headers: { Accept: 'application/json', 'CJ-Access-Token': token }
  });
  const raw = await r.text();
  let json = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { json = { message: raw.slice(0, 300) }; }
  const code = Number(json?.code);
  if (!r.ok || json?.result === false || json?.success === false || (Number.isFinite(code) && ![0, 200].includes(code))) {
    throw new Error(`cj_order_detail_${json?.code || r.status}_${clean(json?.message || 'failed', 180)}`);
  }
  return json.data && typeof json.data === 'object' ? json.data : {};
}

function normalizedStatus(detail) {
  return clean(detail?.orderStatus || detail?.status, 30).toUpperCase() || 'UNKNOWN';
}

function safeTrackingUrl(value) {
  const url = clean(value, 500);
  return /^https?:\/\//i.test(url) ? url : null;
}

function normalizedTracking(row) {
  if (!row || typeof row !== 'object') return null;
  const number = clean(row.number, 200);
  if (!number) return null;
  return {
    number,
    provider: clean(row.provider, 200) || null,
    url: safeTrackingUrl(row.url),
    supplierOrderId: clean(row.supplierOrderId, 80) || null,
    status: clean(row.status, 30).toUpperCase() || null
  };
}

function trackingRichness(row) {
  return Number(Boolean(row?.supplierOrderId)) + Number(Boolean(row?.provider)) + Number(Boolean(row?.url)) + Number(Boolean(row?.status));
}

function mergeTracking(existing, fresh) {
  const byNumber = new Map();
  for (const raw of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(fresh) ? fresh : [])]) {
    const row = normalizedTracking(raw);
    if (!row) continue;
    const previous = byNumber.get(row.number);
    if (!previous || trackingRichness(row) >= trackingRichness(previous)) byNumber.set(row.number, row);
  }
  return [...byNumber.values()].slice(0, 50);
}

function localState(statuses) {
  if (statuses.some((s) => s === 'CANCELLED')) {
    return { status: 'error', fulfillment_status: 'failed', last_error: 'cj_order_cancelled' };
  }
  if (statuses.length && statuses.every((s) => s === 'DELIVERED')) {
    return { status: 'completed', fulfillment_status: 'delivered', last_error: null };
  }
  if (statuses.length && statuses.every((s) => SHIPPED_STATUSES.has(s))) {
    return { status: 'shipped', fulfillment_status: 'shipped', last_error: null };
  }
  if (statuses.length && statuses.every((s) => PAID_STATUSES.has(s))) {
    return { status: 'ordered', fulfillment_status: 'ordered', last_error: null };
  }
  return { status: 'processing', fulfillment_status: 'ordering', last_error: null };
}

async function reconcileAttempt(attempt, order) {
  const ids = Array.isArray(attempt.supplier_order_ids)
    ? attempt.supplier_order_ids.map((x) => clean(x, 80)).filter(Boolean)
    : [];
  if (!ids.length) return { orderId: attempt.order_id, skipped: 'no_supplier_order_ids' };

  const providerOrders = [];
  for (const id of ids) {
    const detail = await cjOrderDetail(id);
    providerOrders.push({
      supplierOrderId: id,
      status: normalizedStatus(detail),
      trackNumber: clean(detail?.trackNumber, 200) || null,
      trackingProvider: clean(detail?.trackingProvider || detail?.logisticName, 200) || null,
      trackingUrl: safeTrackingUrl(detail?.trackingUrl),
      isSandbox: Number((detail?.isSandbox ?? attempt.provider_sandbox) ? 1 : 0),
      checkedAt: new Date().toISOString()
    });
    if (providerOrders.length < ids.length) await sleep(1100);
  }

  const statuses = providerOrders.map((x) => x.status);
  const allPaid = statuses.length > 0 && statuses.every((s) => PAID_STATUSES.has(s));
  const anyCancelled = statuses.some((s) => s === 'CANCELLED');
  const tracking = providerOrders.map((row) => row.trackNumber ? {
    number: row.trackNumber,
    provider: row.trackingProvider,
    url: row.trackingUrl,
    supplierOrderId: row.supplierOrderId,
    status: row.status
  } : null).filter(Boolean);
  const mergedTracking = mergeTracking(order?.tracking_numbers, tracking);
  const state = localState(statuses);
  const now = new Date().toISOString();

  const attemptPatch = {
    response: {
      ...(attempt.response && typeof attempt.response === 'object' ? attempt.response : {}),
      reconciliation: { providerOrders, checkedAt: now }
    },
    error_code: anyCancelled ? 'cj_order_cancelled' : null,
    error_message: anyCancelled ? 'CJ reported a cancelled supplier order; manual review required.' : null
  };
  if (attempt.status === 'payment_pending' && anyCancelled) {
    attemptPatch.status = 'failed';
  } else if (attempt.status === 'payment_pending' && allPaid) {
    attemptPatch.status = 'paid';
    attemptPatch.provider_payment_completed = true;
    attemptPatch.provider_payment_required = false;
  }
  await patch('supplier_order_attempts', `id=eq.${attempt.id}`, attemptPatch);

  const orderPatch = { ...state };
  if (mergedTracking.length) {
    orderPatch.tracking_numbers = mergedTracking;
    orderPatch.tracking_number = mergedTracking[0].number;
  }
  await patch('orders', `order_id=eq.${encodeURIComponent(attempt.order_id)}`, orderPatch);

  return {
    orderId: attempt.order_id,
    attemptId: attempt.id,
    statuses,
    trackingCount: mergedTracking.length,
    localStatus: state.status,
    localFulfillmentStatus: state.fulfillment_status,
    providerPaymentCompleted: attemptPatch.provider_payment_completed === true || attempt.provider_payment_completed === true
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!await requireWorker(req, res)) return;
    const attempts = await dbGet(`supplier_order_attempts?provider=eq.cj&status=in.(payment_pending,paid)&select=id,order_id,status,supplier_order_ids,response,provider_sandbox,provider_payment_required,provider_payment_completed&order=updated_at.asc&limit=${MAX_ATTEMPTS}`);
    const orderIds = [...new Set(attempts.map((x) => clean(x.order_id, 80)).filter(Boolean))];
    const orders = orderIds.length
      ? await dbGet(`orders?order_id=in.(${encodeURIComponent(orderIds.join(','))})&select=order_id,status,fulfillment_status,tracking_number,tracking_numbers`)
      : [];
    const orderMap = new Map(orders.map((o) => [String(o.order_id), o]));
    const results = [];
    let providerOrderCount = 0;

    for (const attempt of attempts) {
      const order = orderMap.get(String(attempt.order_id));
      if (!order) { results.push({ orderId: attempt.order_id, skipped: 'order_missing' }); continue; }
      if (order.fulfillment_status === 'delivered' || order.status === 'completed') {
        results.push({ orderId: attempt.order_id, skipped: 'already_delivered' });
        continue;
      }
      const count = Array.isArray(attempt.supplier_order_ids) ? attempt.supplier_order_ids.length : 0;
      if (providerOrderCount + count > MAX_PROVIDER_ORDERS) break;
      providerOrderCount += count;
      try { results.push(await reconcileAttempt(attempt, order)); }
      catch (error) { results.push({ orderId: attempt.order_id, error: clean(error.message, 220) }); }
      await sleep(1100);
    }

    return res.status(200).json({
      ok: true,
      attemptsScanned: attempts.length,
      providerOrdersScanned: providerOrderCount,
      updated: results.filter((x) => !x.error && !x.skipped).length,
      errors: results.filter((x) => x.error).length,
      results
    });
  } catch (error) {
    console.error('CJ order reconciliation worker failed:', error.message);
    return res.status(500).json({ ok: false, error: clean(error.message, 240) });
  }
};
