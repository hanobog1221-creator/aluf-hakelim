const crypto = require('crypto');
const { serverConfig, serverHeaders } = require('./supabase-server');
const { ensureAccessToken, CJ_BASE } = require('./cj');
const { getFulfillmentCandidate } = require('./fulfillment');

function clean(value, max = 240) { return String(value ?? '').trim().slice(0, max); }
function boolEnv(name, fallback = false) { const raw = clean(process.env[name], 20).toLowerCase(); if (!raw) return fallback; return ['1','true','yes','on'].includes(raw); }
function sandboxMode() { return boolEnv('CJ_SANDBOX', true); }
async function dbGet(path) { const { supabaseUrl } = serverConfig(); const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: serverHeaders() }); if (!r.ok) throw new Error(`db_get_${r.status}`); return r.json(); }
async function dbInsert(table, row) { const { supabaseUrl } = serverConfig(); const r = await fetch(`${supabaseUrl}/rest/v1/${table}`, { method:'POST', headers:serverHeaders({'Content-Type':'application/json',Prefer:'return=representation'}), body:JSON.stringify(row) }); if (!r.ok) throw new Error(`${table}_insert_${r.status}_${(await r.text()).slice(0,140)}`); return (await r.json())[0] || null; }
async function dbPatch(table, filter, patch) { const { supabaseUrl } = serverConfig(); const r = await fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`, { method:'PATCH', headers:serverHeaders({'Content-Type':'application/json',Prefer:'return=representation'}), body:JSON.stringify({...patch,updated_at:new Date().toISOString()}) }); if (!r.ok) throw new Error(`${table}_patch_${r.status}_${(await r.text()).slice(0,140)}`); return (await r.json())[0] || null; }
function quoteLine(order, itemId) { const lines = Array.isArray(order?.shipping_quote?.lines) ? order.shipping_quote.lines : []; return lines.find((x) => String(x?.id || '') === String(itemId || '')) || null; }
function orderNumber(orderId, index) { return `${String(orderId).replace(/[^A-Za-z0-9-]/g,'').slice(0,42)}-CJ${index+1}`; }
function buildRequests(order, supplierState, sandbox) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) throw new Error('no_items');
  const nonCj = items.find((item) => clean(item.supplier,30).toLowerCase() !== 'cj');
  if (nonCj) throw new Error('mixed_or_non_cj_order_not_supported');
  const customer = order.customer || {};
  return items.map((item,index) => {
    const current = supplierState.products.get(String(item.id));
    if (!current || clean(current.fulfillment_provider,20).toLowerCase() !== 'cj') throw new Error(`cj_product_mapping_missing_${item.id}`);
    if (!current.fulfillment_variant_id || !current.fulfillment_sku) throw new Error(`cj_variant_mapping_missing_${item.id}`);
    const shipping = quoteLine(order,item.id);
    if (!shipping?.serviceName) throw new Error(`cj_shipping_service_missing_${item.id}`);
    const request = { orderNumber: orderNumber(order.order_id,index), shippingZip: clean(customer.postalCode || '0000000',20), shippingCountry:'Israel', shippingCountryCode:'IL', shippingProvince:clean(customer.city || 'Israel',100), shippingCity:clean(customer.city,100), shippingPhone:clean(customer.phone,40), shippingCustomerName:clean(customer.fullName,100), shippingAddress:clean(customer.street,160), houseNumber:clean(customer.houseNumber,30), email:clean(customer.email || 'orders@aluf-hakelim.invalid',160), remark:clean(customer.notes || `Aluf Hakelim ${order.order_id}`,300), payType:3, isSandbox:sandbox?1:0, logisticName:clean(shipping.serviceName,120), fromCountryCode:clean(current.fulfillment_origin_country || item.supplierShipFromCountry || 'CN',2).toUpperCase(), platform:'Api', orderFlow:1, products:[{vid:String(current.fulfillment_variant_id),sku:String(current.fulfillment_sku),quantity:Number(item.qty),storeProductId:String(item.id),storeProductName:clean(item.name || current.name,200),storeLineItemId:`${order.order_id}-${index+1}`}] };
    return { itemId:String(item.id), request };
  });
}
function fingerprint(requests) { return crypto.createHash('sha256').update(JSON.stringify(requests.map(x=>x.request)),'utf8').digest('hex'); }
async function existingAttempt(orderId) { const rows = await dbGet(`supplier_order_attempts?order_id=eq.${encodeURIComponent(orderId)}&provider=eq.cj&status=in.(sending,created,payment_pending,paid,ambiguous)&select=*&order=created_at.desc&limit=1`); return rows[0] || null; }
async function cjCreate(request) {
  const token = await ensureAccessToken();
  const r = await fetch(`${CJ_BASE}/shopping/order/createOrderV2`, { method:'POST', headers:{Accept:'application/json','Content-Type':'application/json','CJ-Access-Token':token}, body:JSON.stringify(request) });
  const raw=await r.text(); let json={}; try{json=raw?JSON.parse(raw):{}}catch{json={message:raw.slice(0,300)}} const code=Number(json?.code);
  if(!r.ok||json?.result===false||json?.success===false||(Number.isFinite(code)&&![0,200].includes(code))){const e=new Error(`cj_order_${json?.code||r.status}_${clean(json?.message||'failed',180)}`);e.cj=json;throw e;}
  const data=json.data||{},id=clean(data.orderId||data.id,80);if(!id)throw new Error('cj_order_id_missing');return{id,orderNumber:clean(data.orderNumber||request.orderNumber,80),data,requestId:json.requestId||null};
}
async function preflightCjOrder(orderId, options = {}) {
  const sandbox=sandboxMode();
  const allowClosedSandbox = options.allowClosedSandbox === true && sandbox && process.env.VERCEL_ENV !== 'production' && /^AH-SBX-/i.test(String(orderId||''));
  const { order, validation, supplierState } = await getFulfillmentCandidate(orderId, { ignoreSalesDisabled: allowClosedSandbox });
  if (!validation.ok) return { ok:false, validation };
  const requests=buildRequests(order,supplierState,sandbox);
  return { ok:true, order, validation, sandbox, requests, requestFingerprint:fingerprint(requests), allowClosedSandbox };
}
async function fulfillCjOrder(orderId, options = {}) {
  const preflight=await preflightCjOrder(orderId, options);if(!preflight.ok)return preflight;
  const duplicate=await existingAttempt(orderId);if(duplicate)return{ok:false,validation:{ok:false,reason:'supplier_attempt_already_exists'},attempt:duplicate};
  const attempt=await dbInsert('supplier_order_attempts',{order_id:orderId,request_fingerprint:preflight.requestFingerprint,status:'prepared',provider:'cj',provider_sandbox:preflight.sandbox,provider_payment_required:true,provider_payment_completed:false,response:{requests:preflight.requests.map(x=>({itemId:x.itemId,orderNumber:x.request.orderNumber,sandbox:preflight.sandbox}))}});
  await dbPatch('supplier_order_attempts',`id=eq.${attempt.id}`,{status:'sending'});
  const created=[];
  try{for(const group of preflight.requests)created.push({...await cjCreate(group.request),itemId:group.itemId});}catch(error){if(created.length){await dbPatch('supplier_order_attempts',`id=eq.${attempt.id}`,{status:'ambiguous',supplier_order_ids:created.map(x=>x.id),error_code:'partial_create',error_message:clean(error.message,500),response:{created,error:clean(error.message,500)}});return{ok:false,ambiguous:true,error:'partial_supplier_order_create',created};}await dbPatch('supplier_order_attempts',`id=eq.${attempt.id}`,{status:'failed',error_code:'create_failed',error_message:clean(error.message,500),response:{error:clean(error.message,500)}});throw error;}
  const ids=created.map(x=>x.id),providerCost=created.reduce((sum,x)=>sum+Number(x.data?.orderAmount||0),0)||null;
  await dbPatch('supplier_order_attempts',`id=eq.${attempt.id}`,{status:'payment_pending',supplier_order_ids:ids,provider_order_number:created[0]?.orderNumber||null,provider_payment_required:true,provider_payment_completed:false,provider_cost:providerCost,provider_currency:'USD',response:{created:created.map(x=>({id:x.id,orderNumber:x.orderNumber,itemId:x.itemId,postageAmount:x.data?.postageAmount??null,productAmount:x.data?.productAmount??null,logisticsMiss:x.data?.logisticsMiss??null}))}});
  await dbPatch('orders',`order_id=eq.${encodeURIComponent(orderId)}`,{supplier_order_id:ids[0]||null,supplier_order_ids:ids,fulfillment_status:'ordering',last_error:null});
  return{ok:true,sandbox:preflight.sandbox,chargedSupplier:false,paymentRequired:true,orderId,supplierOrderIds:ids,attemptId:attempt.id,created};
}
module.exports={sandboxMode,buildRequests,preflightCjOrder,fulfillCjOrder};
