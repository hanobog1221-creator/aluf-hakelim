const crypto = require('crypto');
const { serverConfig, serverHeaders } = require('./supabase-server');
const { ensureAccessToken, CJ_BASE } = require('./cj');
const { getFulfillmentCandidate } = require('./fulfillment');

function clean(value, max = 240) { return String(value ?? '').trim().slice(0, max); }
function boolEnv(name, fallback = false) {
  const raw = clean(process.env[name], 20).toLowerCase();
  if (!raw) return fallback;
  return ['1','true','yes','on'].includes(raw);
}
function sandboxMode() { return boolEnv('CJ_SANDBOX', true); }
function autoPayEnabled() { return boolEnv('CJ_AUTO_PAY', false); }
function manualPagePaymentEnabled() {
  return process.env.VERCEL_ENV === 'production' && boolEnv('CJ_MANUAL_PAGE_PAYMENT_ENABLED', true);
}
function isForcedSandboxOrder(orderId) { return /^AH-SBX-PAY-[A-Z0-9-]{5,60}$/i.test(String(orderId || '')); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function dbGet(path) {
  const { supabaseUrl } = serverConfig();
  const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: serverHeaders() });
  if (!r.ok) throw new Error(`db_get_${r.status}`);
  return r.json();
}
async function dbInsert(table, row) {
  const { supabaseUrl } = serverConfig();
  const r = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method:'POST', headers:serverHeaders({'Content-Type':'application/json',Prefer:'return=representation'}), body:JSON.stringify(row)
  });
  if (!r.ok) throw new Error(`${table}_insert_${r.status}_${(await r.text()).slice(0,140)}`);
  return (await r.json())[0] || null;
}
async function dbPatch(table, filter, patch) {
  const { supabaseUrl } = serverConfig();
  const r = await fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`, {
    method:'PATCH', headers:serverHeaders({'Content-Type':'application/json',Prefer:'return=representation'}), body:JSON.stringify({...patch,updated_at:new Date().toISOString()})
  });
  if (!r.ok) throw new Error(`${table}_patch_${r.status}_${(await r.text()).slice(0,140)}`);
  return (await r.json())[0] || null;
}

async function cjRequest(path, { method='GET', body } = {}) {
  const token = await ensureAccessToken();
  const headers = { Accept:'application/json', 'CJ-Access-Token':token };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${CJ_BASE}${path}`, { method, headers, body:body===undefined?undefined:JSON.stringify(body) });
  const raw = await r.text();
  let json = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { json = { message:raw.slice(0,300) }; }
  const code = Number(json?.code);
  if (!r.ok || json?.result === false || json?.success === false || (Number.isFinite(code) && ![0,200].includes(code))) {
    const e = new Error(`cj_api_${json?.code || r.status}_${clean(json?.message || 'failed',180)}`);
    e.cj = json;
    e.status = r.status;
    throw e;
  }
  return json;
}

async function getBalanceUsd() {
  const json = await cjRequest('/shopping/pay/getBalance');
  const amount = Number(json?.data?.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('cj_balance_unavailable');
  return Number(amount.toFixed(2));
}

function quoteLine(order, itemId) {
  const lines = Array.isArray(order?.shipping_quote?.lines) ? order.shipping_quote.lines : [];
  return lines.find((x) => String(x?.id || '') === String(itemId || '')) || null;
}
function orderNumber(orderId, index) {
  return `${String(orderId).replace(/[^A-Za-z0-9-]/g,'').slice(0,42)}-CJ${index+1}`;
}
function buildRequests(order, supplierState, sandbox, autoPay = false) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) throw new Error('no_items');
  const nonCj = items.find((item) => clean(item.supplier,30).toLowerCase() !== 'cj');
  if (nonCj) throw new Error('mixed_or_non_cj_order_not_supported');
  const customer = order.customer || {};
  const payType = sandbox ? 3 : (autoPay ? 2 : 1);
  return items.map((item,index) => {
    const current = supplierState.products.get(String(item.id));
    if (!current || clean(current.fulfillment_provider,20).toLowerCase() !== 'cj') throw new Error(`cj_product_mapping_missing_${item.id}`);
    if (!current.fulfillment_variant_id || !current.fulfillment_sku) throw new Error(`cj_variant_mapping_missing_${item.id}`);
    const shipping = quoteLine(order,item.id);
    if (!shipping?.serviceName) throw new Error(`cj_shipping_service_missing_${item.id}`);
    const request = {
      orderNumber:orderNumber(order.order_id,index), shippingZip:clean(customer.postalCode || '0000000',20),
      shippingCountry:'Israel', shippingCountryCode:'IL', shippingProvince:clean(customer.city || 'Israel',50),
      shippingCity:clean(customer.city,50), shippingPhone:clean(customer.phone,40), shippingCustomerName:clean(customer.fullName,100),
      shippingAddress:clean(customer.street,160), houseNumber:clean(customer.houseNumber,30),
      email:clean(customer.email || 'orders@aluf-hakelim.invalid',160), remark:clean(customer.notes || `Aluf Hakelim ${order.order_id}`,300),
      payType, isSandbox:sandbox?1:0, logisticName:clean(shipping.serviceName,50),
      fromCountryCode:clean(current.fulfillment_origin_country || item.supplierShipFromCountry || 'CN',2).toUpperCase(),
      platform:'Api', orderFlow:1,
      products:[{vid:String(current.fulfillment_variant_id),sku:String(current.fulfillment_sku),quantity:Number(item.qty),storeProductId:String(item.id),storeProductName:clean(item.name || current.name,200),storeLineItemId:`${order.order_id}-${index+1}`}]
    };
    return { itemId:String(item.id), request };
  });
}
function fingerprint(requests) { return crypto.createHash('sha256').update(JSON.stringify(requests.map(x=>x.request)),'utf8').digest('hex'); }
async function existingAttempt(orderId) {
  const rows = await dbGet(`supplier_order_attempts?order_id=eq.${encodeURIComponent(orderId)}&provider=eq.cj&status=in.(sending,created,payment_pending,paid,ambiguous)&select=*&order=created_at.desc&limit=1`);
  return rows[0] || null;
}
async function cjCreate(request) {
  const json = await cjRequest('/shopping/order/createOrderV2', { method:'POST', body:request });
  const data = json.data || {};
  const id = clean(data.orderId || data.id,80);
  if (!id) throw new Error('cj_order_id_missing');
  return {
    id,
    shipmentOrderId:clean(data.shipmentOrderId,100) || null,
    orderNumber:clean(data.orderNumber || request.orderNumber,80),
    orderStatus:clean(data.orderStatus,30) || null,
    paymentUrl:safeCjPaymentUrl(data.cjPayUrl),
    data,
    requestId:json.requestId || null
  };
}
function safeCjPaymentUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !/(^|\.)cjdropshipping\.com$/i.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
async function cjOrderDetail(orderId) {
  const json = await cjRequest(`/shopping/order/getOrderDetail?orderId=${encodeURIComponent(orderId)}`);
  return json.data || {};
}
function paidStatus(status) {
  return ['PENDING','PROCESSING','UNSHIPPED','SHIPPED','DELIVERED'].includes(clean(status,30).toUpperCase());
}
async function waitForOrderStatus(orderId, predicate, tries = 10) {
  let detail = {}, status = '';
  for (let i=0;i<tries;i++) {
    if (i) await sleep(1250);
    detail = await cjOrderDetail(orderId);
    status = clean(detail.orderStatus || detail.status,30).toUpperCase();
    if (predicate(status)) return { status, detail };
  }
  return { status, detail };
}
async function verifyAutoPaid(created) {
  let latest = created.data || {};
  let status = clean(created.orderStatus || latest.orderStatus,30).toUpperCase();
  if (paidStatus(status)) return { paid:true, status, detail:latest };
  for (let i=0;i<3;i++) {
    await sleep(1200);
    latest = await cjOrderDetail(created.id);
    status = clean(latest.orderStatus || latest.status,30).toUpperCase();
    if (paidStatus(status)) return { paid:true, status, detail:latest };
  }
  return { paid:false, status:status || null, detail:latest };
}
async function simulateForcedSandboxPayment(created) {
  let detail = await cjOrderDetail(created.id);
  let status = clean(detail.orderStatus || detail.status || created.orderStatus,30).toUpperCase();
  if (['CREATED','IN_CART'].includes(status)) {
    try {
      await cjRequest('/shopping/order/confirmOrder', { method:'PATCH', body:{ orderId:created.id } });
    } catch (error) {
      const message = clean(error.message,260).toLowerCase();
      if (!message.includes('being confirmed') && !message.includes('try again later')) throw error;
    }
    const confirmed = await waitForOrderStatus(created.id, (s) => s === 'UNPAID' || paidStatus(s), 12);
    status = confirmed.status;
    detail = confirmed.detail;
  }
  if (status === 'UNPAID') {
    await cjRequest('/shopping/sandbox/simulatePay', { method:'POST', body:{ orderId:created.id } });
    const paid = await waitForOrderStatus(created.id, (s) => paidStatus(s), 10);
    status = paid.status;
    detail = paid.detail;
  }
  return { paid:paidStatus(status), status:status || null, detail, simulated:true };
}

async function preflightCjOrder(orderId, options = {}) {
  const forcedSandbox = isForcedSandboxOrder(orderId);
  const configuredAutoPay = autoPayEnabled();
  const manualPagePayment = !forcedSandbox && !configuredAutoPay && manualPagePaymentEnabled();
  const sandbox = forcedSandbox ? true : (manualPagePayment ? false : sandboxMode());
  const autoPay = !sandbox && configuredAutoPay;
  const previewClosedSandbox = options.allowClosedSandbox === true && sandbox && process.env.VERCEL_ENV !== 'production' && /^AH-SBX-/i.test(String(orderId||''));
  const allowClosedSandbox = forcedSandbox || previewClosedSandbox;
  const { order, validation, supplierState } = await getFulfillmentCandidate(orderId, { ignoreSalesDisabled:allowClosedSandbox });
  if (!validation.ok) return { ok:false, validation };
  let balanceUsd = null;
  if (autoPay) {
    balanceUsd = await getBalanceUsd();
    if (balanceUsd <= 0) return { ok:false, validation:{ok:false,reason:'cj_balance_empty'}, balanceUsd };
  }
  const requests = buildRequests(order,supplierState,sandbox,autoPay);
  return { ok:true, order, validation, sandbox, autoPay, manualPagePayment, balanceUsd, requests, requestFingerprint:fingerprint(requests), allowClosedSandbox, forcedSandbox };
}

async function fulfillCjOrder(orderId, options = {}) {
  const preflight = await preflightCjOrder(orderId, options);
  if (!preflight.ok) return preflight;
  const duplicate = await existingAttempt(orderId);
  if (duplicate) return {ok:false,validation:{ok:false,reason:'supplier_attempt_already_exists'},attempt:duplicate};

  const paymentMode = preflight.forcedSandbox ? 'sandbox_simulated' : (preflight.autoPay ? 'balance_auto' : (preflight.manualPagePayment ? 'page_manual' : 'create_only'));
  const attempt = await dbInsert('supplier_order_attempts', {
    order_id:orderId, request_fingerprint:preflight.requestFingerprint, status:'prepared', provider:'cj',
    provider_sandbox:preflight.sandbox, provider_payment_required:true, provider_payment_completed:false,
    response:{paymentMode,forcedSandbox:preflight.forcedSandbox===true,balanceBeforeUsd:preflight.balanceUsd,requests:preflight.requests.map(x=>({itemId:x.itemId,orderNumber:x.request.orderNumber,payType:x.request.payType,sandbox:preflight.sandbox}))}
  });
  await dbPatch('supplier_order_attempts',`id=eq.${attempt.id}`,{status:'sending'});

  const created=[];
  try {
    for (const group of preflight.requests) created.push({...await cjCreate(group.request),itemId:group.itemId});
  } catch(error) {
    if (created.length) {
      await dbPatch('supplier_order_attempts',`id=eq.${attempt.id}`,{status:'ambiguous',supplier_order_ids:created.map(x=>x.id),error_code:'partial_create',error_message:clean(error.message,500),response:{created,error:clean(error.message,500)}});
      return {ok:false,ambiguous:true,error:'partial_supplier_order_create',created};
    }
    await dbPatch('supplier_order_attempts',`id=eq.${attempt.id}`,{status:'failed',error_code:'create_failed',error_message:clean(error.message,500),response:{error:clean(error.message,500)}});
    throw error;
  }

  let paymentChecks=[];
  if (preflight.forcedSandbox) {
    for (const row of created) paymentChecks.push({id:row.id,...await simulateForcedSandboxPayment(row)});
  } else if (preflight.autoPay) {
    for (const row of created) paymentChecks.push({id:row.id,...await verifyAutoPaid(row)});
  }
  const supplierPaid = (preflight.forcedSandbox || preflight.autoPay)
    && paymentChecks.length === created.length
    && paymentChecks.every(x=>x.paid);
  const ids = created.map(x=>x.id);
  const providerCost = created.reduce((sum,x)=>sum+Number(x.data?.orderAmount||0)+Number(x.data?.postageAmount||0),0) || null;
  const attemptStatus = supplierPaid ? 'paid' : 'payment_pending';
  const paymentRequired = !supplierPaid;
  const response = {
    paymentMode,
    forcedSandbox:preflight.forcedSandbox===true,
    balanceBeforeUsd:preflight.balanceUsd,
    created:created.map(x=>({id:x.id,shipmentOrderId:x.shipmentOrderId,orderNumber:x.orderNumber,itemId:x.itemId,orderStatus:x.orderStatus,paymentUrl:x.paymentUrl,postageAmount:x.data?.postageAmount??null,productAmount:x.data?.productAmount??null,logisticsMiss:x.data?.logisticsMiss??null})),
    paymentChecks
  };
  await dbPatch('supplier_order_attempts',`id=eq.${attempt.id}`,{
    status:attemptStatus, supplier_order_ids:ids, provider_order_number:created[0]?.orderNumber||null,
    provider_payment_required:paymentRequired, provider_payment_completed:supplierPaid,
    provider_cost:providerCost, provider_currency:'USD', response
  });
  await dbPatch('orders',`order_id=eq.${encodeURIComponent(orderId)}`,{
    supplier_order_id:ids[0]||null, supplier_order_ids:ids,
    fulfillment_status:supplierPaid?'ordered':'waiting', last_error:supplierPaid?null:'manual_supplier_payment_required'
  });
  return {
    ok:true, sandbox:preflight.sandbox, forcedSandbox:preflight.forcedSandbox===true, autoPay:preflight.autoPay,
    chargedSupplier:!preflight.sandbox && supplierPaid,
    paymentRequired, providerPaymentCompleted:supplierPaid,
    balanceBeforeUsd:preflight.balanceUsd,
    orderId, supplierOrderIds:ids, paymentUrls:created.map(x=>x.paymentUrl).filter(Boolean), attemptId:attempt.id, created, paymentChecks
  };
}

module.exports={sandboxMode,autoPayEnabled,manualPagePaymentEnabled,safeCjPaymentUrl,getBalanceUsd,buildRequests,preflightCjOrder,fulfillCjOrder};
