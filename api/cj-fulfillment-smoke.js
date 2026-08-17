const { serverConfig, serverHeaders } = require('./_lib/supabase-server');
const { fulfillCjOrder } = require('./_lib/cj-fulfillment');

function clean(v,max=160){return String(v??'').trim().slice(0,max)}
async function getProduct(){
  const {supabaseUrl}=serverConfig();
  const r=await fetch(`${supabaseUrl}/rest/v1/products?id=eq.ae-1005010757861759&select=id,name,selling_price,supplier,supplier_id,supplier_product_id,supplier_sku_id,supplier_price_ils,supplier_shipping,supplier_in_stock,supplier_shipping_available,fulfillment_ready,fulfillment_provider,fulfillment_product_id,fulfillment_variant_id,fulfillment_sku,fulfillment_origin_country,fulfillment_logistic_name,fulfillment_verified_at&limit=1`,{headers:serverHeaders()});
  if(!r.ok)throw new Error(`smoke_product_read_${r.status}`);return(await r.json())[0]||null;
}
async function insertOrder(row){
  const {supabaseUrl}=serverConfig();
  const r=await fetch(`${supabaseUrl}/rest/v1/orders`,{method:'POST',headers:serverHeaders({'Content-Type':'application/json',Prefer:'return=representation'}),body:JSON.stringify(row)});
  const raw=await r.text();if(!r.ok)throw new Error(`smoke_order_insert_${r.status}_${raw.slice(0,180)}`);return JSON.parse(raw)[0];
}
async function readAttempt(orderId){
  const {supabaseUrl}=serverConfig();
  const r=await fetch(`${supabaseUrl}/rest/v1/supplier_order_attempts?order_id=eq.${encodeURIComponent(orderId)}&provider=eq.cj&select=id,status,supplier_order_ids,provider_sandbox,provider_payment_required,provider_payment_completed,provider_cost,provider_currency,error_code,error_message,response&order=created_at.desc&limit=1`,{headers:serverHeaders()});
  if(!r.ok)return null;return(await r.json())[0]||null;
}
module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  if(process.env.VERCEL_ENV==='production')return res.status(403).json({ok:false,error:'preview_only'});
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
  try{
    const p=await getProduct();
    if(!p||p.fulfillment_provider!=='cj'||p.fulfillment_ready!==true||!p.fulfillment_product_id||!p.fulfillment_variant_id||!p.fulfillment_sku||p.supplier_in_stock!==true||p.supplier_shipping_available!==true)throw new Error('smoke_product_not_ready');
    const now=new Date();const suffix=now.toISOString().replace(/\D/g,'').slice(2,14);const orderId=`AH-SBX-E2E-${suffix}`;
    const shipping=Number(p.supplier_shipping||0),price=Number(p.selling_price||0);
    const item={id:p.id,name:p.name,price,qty:1,supplier:'cj',supplierId:p.supplier_id||null,supplierProductId:p.supplier_product_id,supplierSkuId:p.supplier_sku_id,supplierShipFromCountry:p.fulfillment_origin_country||'CN',fulfillmentReady:true};
    const quote={status:'quoted',total:shipping,currency:'ILS',quotedAt:now.toISOString(),lines:[{id:p.id,provider:'cj',qty:1,cost:shipping,currency:'ILS',serviceName:p.fulfillment_logistic_name||'CJPacket Liquid Line'}]};
    const order=await insertOrder({order_id:orderId,status:'paid',total:price,currency:'ILS',items:[item],customer:{fullName:'Aluf Hakelim Sandbox',phone:'0500000000',email:'sandbox@example.com',city:'Jerusalem',street:'Jaffa Street',houseNumber:'1',postalCode:'9100001',countryCode:'IL',notes:'Automated CJ sandbox fulfillment smoke test'},payment_status:'paid',payment_provider:'sandbox_synthetic',payment_reference:`SBX-${suffix}`,fulfillment_status:'not_started',shipping_cost:shipping,shipping_quote_status:'quoted',shipping_quote:quote,shipping_quoted_at:now.toISOString(),products_subtotal:price,discount_amount:0,client_request_id:`sandbox_e2e_${suffix}`,admin_note:'AUTOMATED PREVIEW SANDBOX TEST - NO CUSTOMER PAYMENT',terms_accepted_at:now.toISOString(),terms_version:'sandbox-e2e',paid_at:now.toISOString(),supplier_order_ids:[]});
    const fulfillment=await fulfillCjOrder(orderId,{allowClosedSandbox:true});
    const attempt=await readAttempt(orderId);
    return res.status(200).json({ok:Boolean(fulfillment?.ok),sandbox:true,customerPayment:false,supplierCharge:false,order:{orderId:order.order_id,paymentStatus:order.payment_status,shippingCost:order.shipping_cost},fulfillment:{ok:fulfillment?.ok,sandbox:fulfillment?.sandbox,chargedSupplier:fulfillment?.chargedSupplier,supplierOrderIds:fulfillment?.supplierOrderIds||[],error:fulfillment?.error||fulfillment?.validation?.reason||null},attempt:attempt?{status:attempt.status,supplierOrderIds:attempt.supplier_order_ids,providerSandbox:attempt.provider_sandbox,providerPaymentRequired:attempt.provider_payment_required,providerPaymentCompleted:attempt.provider_payment_completed,providerCost:attempt.provider_cost,providerCurrency:attempt.provider_currency,errorCode:attempt.error_code,errorMessage:attempt.error_message}:null});
  }catch(e){console.error('CJ fulfillment smoke failed:',e.message);return res.status(500).json({ok:false,sandbox:true,customerPayment:false,supplierCharge:false,error:clean(e.message,240)});}
};
