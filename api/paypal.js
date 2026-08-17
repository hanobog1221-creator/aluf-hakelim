const { serverConfig, serverHeaders } = require('./_lib/supabase-server');
const { sandboxMode, autoPayEnabled } = require('./_lib/cj-fulfillment');
const { aliExpressLiveAutomationReady } = require('./_lib/aliexpress-fulfillment');
const { fulfillPaidOrder } = require('./_lib/paid-order-fulfillment');
const { paypalSettlement } = require('./_lib/paypal-finance');
const { readProviderCredentials } = require('./_lib/provider-credentials');

function clean(value, max = 200) { return String(value ?? '').trim().slice(0, max); }
function normalizedPayPalEnvironment(value) { return clean(value || 'sandbox', 20).toLowerCase() === 'live' ? 'live' : 'sandbox'; }
function isSandboxPaymentTest(orderId) { return /^AH-SBX-PAY-[A-Z0-9-]{5,60}$/.test(String(orderId || '').toUpperCase()); }
function requestOrigin(req) {
  const proto = clean(String(req.headers['x-forwarded-proto'] || 'https').split(',')[0], 10).toLowerCase();
  const host = clean(String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0], 300);
  if (!['http','https'].includes(proto) || !host || !/^[A-Za-z0-9.-]+(?::\d+)?$/.test(host)) throw new Error('invalid_request_host');
  return `${proto}://${host}`;
}
function approvalLink(created, environment) {
  const links = Array.isArray(created?.links) ? created.links : [];
  const row = links.find((x) => ['payer-action', 'approve'].includes(String(x?.rel || '').toLowerCase()));
  const href = clean(row?.href, 2000);
  try {
    const url = new URL(href);
    const expected = environment === 'live' ? 'www.paypal.com' : 'www.sandbox.paypal.com';
    return url.protocol === 'https:' && url.hostname.toLowerCase() === expected ? url.toString() : null;
  } catch {
    return null;
  }
}
async function paypalConfig() {
  const stored = await readProviderCredentials('paypal').catch(() => null);
  const clientId = clean(process.env.PAYPAL_CLIENT_ID || stored?.client_id, 300);
  const secret = clean(process.env.PAYPAL_CLIENT_SECRET || stored?.client_secret, 300);
  const environment = normalizedPayPalEnvironment(process.env.PAYPAL_ENVIRONMENT || process.env.PAYPAL_ENV || stored?.environment || 'sandbox');
  if (!clientId || !secret) throw new Error('paypal_not_configured');
  return { clientId, secret, environment, baseUrl: environment === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com', currency: 'ILS' };
}
async function paypalToken(cfg){
  const basic=Buffer.from(`${cfg.clientId}:${cfg.secret}`,'utf8').toString('base64');
  const r=await fetch(`${cfg.baseUrl}/v1/oauth2/token`,{method:'POST',headers:{Accept:'application/json','Accept-Language':'en_US',Authorization:`Basic ${basic}`,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
  const raw=await r.text();let json={};try{json=raw?JSON.parse(raw):{}}catch{}
  if(!r.ok||!json.access_token)throw new Error(`paypal_auth_${r.status}`);return json.access_token;
}
async function paypalRequest(cfg,path,{method='GET',body,requestId}={}){
  const token=await paypalToken(cfg);const headers={Accept:'application/json',Authorization:`Bearer ${token}`,'Content-Type':'application/json'};if(requestId)headers['PayPal-Request-Id']=clean(requestId,108);
  const r=await fetch(`${cfg.baseUrl}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const raw=await r.text();let json={};try{json=raw?JSON.parse(raw):{}}catch{json={message:raw.slice(0,300)}}
  if(!r.ok){const issue=json?.details?.[0]?.issue||json?.name||`http_${r.status}`;const e=new Error(`paypal_${issue}`.slice(0,220));e.status=r.status;e.paypal=json;throw e;}return json;
}
async function rpc(name,args){const{supabaseUrl}=serverConfig();const r=await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`,{method:'POST',headers:serverHeaders({'Content-Type':'application/json'}),body:JSON.stringify(args||{})});if(!r.ok)throw new Error(`${name}_${r.status}`);return r.json();}
async function paymentReadiness(orderId){return rpc(isSandboxPaymentTest(orderId)?'check_sandbox_payment_readiness':'check_order_payment_readiness',{p_order_id:orderId});}
async function readOrder(orderId){const{supabaseUrl}=serverConfig();const r=await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=order_id,status,payment_status,payment_provider,payment_reference,currency,total,shipping_cost&limit=1`,{headers:serverHeaders()});if(!r.ok)throw new Error(`order_read_${r.status}`);return(await r.json())[0]||null;}
async function markPaymentPending(orderId,paypalOrderId){const{supabaseUrl}=serverConfig();const r=await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}`,{method:'PATCH',headers:serverHeaders({'Content-Type':'application/json',Prefer:'return=minimal'}),body:JSON.stringify({status:'payment_pending',payment_provider:'paypal',payment_reference:paypalOrderId,last_error:null,updated_at:new Date().toISOString()})});if(!r.ok)throw new Error(`order_payment_pending_${r.status}`);}
function amountString(value){const n=Number(value);if(!Number.isFinite(n)||n<=0||n>1000000)throw new Error('invalid_order_amount');return n.toFixed(2);}
function captureRecord(paypalOrder){for(const unit of(Array.isArray(paypalOrder?.purchase_units)?paypalOrder.purchase_units:[])){const captures=Array.isArray(unit?.payments?.captures)?unit.payments.captures:[];const c=captures.find(x=>x?.status==='COMPLETED');if(c)return c;}return null;}
function publicLiveGate(cfg, sandboxTest) {
  if (sandboxTest) {
    if (cfg.environment !== 'sandbox') return 'sandbox_test_requires_paypal_sandbox';
    return null;
  }
  if (cfg.environment !== 'live') return 'paypal_live_required';
  const cjReady = !sandboxMode() && autoPayEnabled();
  const aliExpressReady = aliExpressLiveAutomationReady();
  if (!cjReady && !aliExpressReady) return 'supplier_autopay_required';
  return null;
}

async function handleCreate(req,res,body){
  const orderId=clean(body.orderId,80).toUpperCase();if(!/^AH-[A-Z0-9-]{5,60}$/.test(orderId))return res.status(400).json({ok:false,error:'invalid_order_id'});
  const cfg=await paypalConfig();
  const sandboxTest=isSandboxPaymentTest(orderId);
  const liveBlock=publicLiveGate(cfg,sandboxTest);if(liveBlock)return res.status(409).json({ok:false,error:liveBlock});
  const readiness=await paymentReadiness(orderId);if(!readiness?.ok)return res.status(409).json({ok:false,error:readiness?.reason||'order_not_payable',readiness});
  if(String(readiness.currency||'').toUpperCase()!==cfg.currency)return res.status(409).json({ok:false,error:'currency_mismatch'});const value=amountString(readiness.amount);
  const origin=requestOrigin(req);
  const returnPath=sandboxTest?'/admin-paypal-test.html':'/';
  const returnUrl=`${origin}${returnPath}?paypal=approved&storeOrderId=${encodeURIComponent(orderId)}`;
  const cancelUrl=`${origin}${returnPath}?paypal=cancelled&storeOrderId=${encodeURIComponent(orderId)}`;
  const created=await paypalRequest(cfg,'/v2/checkout/orders',{method:'POST',requestId:`create-${orderId}`,body:{
    intent:'CAPTURE',
    purchase_units:[{reference_id:orderId,custom_id:orderId,invoice_id:orderId,description:sandboxTest?'Aluf Hakelim sandbox test':'Aluf Hakelim order',amount:{currency_code:cfg.currency,value}}],
    payment_source:{paypal:{experience_context:{return_url:returnUrl,cancel_url:cancelUrl,user_action:'PAY_NOW',shipping_preference:'NO_SHIPPING',locale:'he-IL'}}}
  }});
  if(!created?.id)throw new Error('paypal_order_id_missing');
  const approveUrl=approvalLink(created,cfg.environment);if(!approveUrl)throw new Error('paypal_approval_url_missing');
  await markPaymentPending(orderId,created.id);
  return res.status(200).json({ok:true,orderId:created.id,storeOrderId:orderId,environment:cfg.environment,sandboxTest,approveUrl});
}

async function handleCapture(res,body){
  const orderId=clean(body.orderId,80).toUpperCase(),paypalOrderId=clean(body.paypalOrderId,80);if(!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)||!paypalOrderId)return res.status(400).json({ok:false,error:'invalid_capture_request'});
  const stored=await readOrder(orderId);if(!stored)return res.status(404).json({ok:false,error:'order_not_found'});if(stored.payment_status==='paid')return res.status(409).json({ok:false,error:'order_already_paid'});if(stored.payment_provider&&stored.payment_provider!=='paypal')return res.status(409).json({ok:false,error:'payment_provider_mismatch'});if(stored.payment_reference&&stored.payment_reference!==paypalOrderId)return res.status(409).json({ok:false,error:'paypal_order_mismatch'});
  const cfg=await paypalConfig();
  const sandboxTest=isSandboxPaymentTest(orderId);
  const liveBlock=publicLiveGate(cfg,sandboxTest);if(liveBlock)return res.status(409).json({ok:false,error:liveBlock});
  const readiness=await paymentReadiness(orderId);if(!readiness?.ok)return res.status(409).json({ok:false,error:readiness?.reason||'order_not_payable',readiness});
  const expectedValue=amountString(readiness.amount);
  const capturedOrder=await paypalRequest(cfg,`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,{method:'POST',requestId:`capture-${orderId}`,body:{}});const capture=captureRecord(capturedOrder);
  if(capturedOrder?.status!=='COMPLETED'||!capture||capture.status!=='COMPLETED')return res.status(409).json({ok:false,error:'paypal_capture_not_completed'});
  const capturedCurrency=clean(capture?.amount?.currency_code,3).toUpperCase(),capturedValue=amountString(capture?.amount?.value);if(capturedCurrency!==cfg.currency||capturedValue!==expectedValue)return res.status(409).json({ok:false,error:'paypal_capture_amount_mismatch'});
  const settlement=paypalSettlement(capture);
  const confirmed=await rpc('confirm_order_payment',{p_provider:'paypal',p_provider_event_id:String(capture.id),p_order_id:orderId,p_amount:Number(capturedValue),p_currency:capturedCurrency,p_payment_reference:String(capture.id),p_payload:{paypalOrderId,captureId:capture.id,status:capture.status,environment:cfg.environment,sandboxTest,settlement}});if(!confirmed?.ok)return res.status(409).json({ok:false,error:confirmed?.error||'payment_confirmation_failed'});

  let fulfillment={ok:false,skipped:true,reason:'not_attempted'};
  try{fulfillment=await fulfillPaidOrder(orderId);}catch(error){fulfillment={ok:false,error:clean(error.message||error,220)};console.error('Supplier fulfillment after PayPal capture failed:',error.message);}
  return res.status(200).json({ok:true,orderId,paypalOrderId,captureId:String(capture.id),paymentStatus:'paid',environment:cfg.environment,sandboxTest,fulfillment});
}

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  try{
    const action=clean(req.query?.action,30);
    if(req.method==='GET'&&action==='config'){const cfg=await paypalConfig();const supplierReady=(!sandboxMode()&&autoPayEnabled())||aliExpressLiveAutomationReady();return res.status(200).json({ok:true,clientId:cfg.clientId,currency:cfg.currency,environment:cfg.environment,publicPaymentsReady:cfg.environment==='live'&&supplierReady});}
    if(req.method!=='POST')return res.status(405).json({ok:false,error:'method_not_allowed'});
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    if(action==='create')return await handleCreate(req,res,body);if(action==='capture')return await handleCapture(res,body);
    return res.status(400).json({ok:false,error:'invalid_action'});
  }catch(error){console.error('PayPal checkout failed:',error.message);const code=clean(error.message||error,220);return res.status(error.status&&error.status>=400&&error.status<600?error.status:500).json({ok:false,error:code||'paypal_failed'});}
};

