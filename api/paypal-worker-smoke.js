const { requireWorker } = require('./_lib/cj-worker-auth');

function clean(v,max=300){return String(v??'').trim().slice(0,max)}
function config(){
  const clientId=clean(process.env.PAYPAL_CLIENT_ID,300),secret=clean(process.env.PAYPAL_CLIENT_SECRET,300),env=clean(process.env.PAYPAL_ENVIRONMENT||process.env.PAYPAL_ENV||'sandbox',20).toLowerCase();
  if(!clientId||!secret)throw new Error('paypal_not_configured');
  if(env==='live')throw new Error('paypal_live_smoke_blocked');
  return{clientId,secret,base:'https://api-m.sandbox.paypal.com'};
}
async function token(cfg){
  const auth=Buffer.from(`${cfg.clientId}:${cfg.secret}`,'utf8').toString('base64');
  const r=await fetch(`${cfg.base}/v1/oauth2/token`,{method:'POST',headers:{Accept:'application/json',Authorization:`Basic ${auth}`,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});const raw=await r.text();let j={};try{j=raw?JSON.parse(raw):{}}catch{};if(!r.ok||!j.access_token)throw new Error(`paypal_auth_${r.status}`);return j.access_token;
}
module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  try{
    if(!await requireWorker(req,res))return;
    const cfg=config(),access=await token(cfg),stamp=Date.now().toString(36).toUpperCase(),invoice=`AH-SBX-PP-${stamp}`;
    const r=await fetch(`${cfg.base}/v2/checkout/orders`,{method:'POST',headers:{Accept:'application/json',Authorization:`Bearer ${access}`,'Content-Type':'application/json','PayPal-Request-Id':`smoke-${stamp}`},body:JSON.stringify({intent:'CAPTURE',purchase_units:[{reference_id:invoice,custom_id:invoice,invoice_id:invoice,description:'Aluf Hakelim PayPal sandbox smoke test - no capture',amount:{currency_code:'ILS',value:'1.00'}}]})});
    const raw=await r.text();let j={};try{j=raw?JSON.parse(raw):{}}catch{j={message:raw.slice(0,300)}};if(!r.ok||!j.id)throw new Error(`paypal_create_${r.status}_${clean(j?.name||j?.message||'failed',120)}`);
    return res.status(200).json({ok:true,environment:'sandbox',oauth:true,orderCreated:true,captured:false,charged:false,paypalOrderId:j.id,status:j.status||null,currency:'ILS',amount:'1.00'});
  }catch(e){return res.status(500).json({ok:false,environment:'sandbox',captured:false,charged:false,error:clean(e.message||e,220)})}
};
