const { requireAdmin, audit } = require('../_lib/admin');
const { preflightCjOrder, fulfillCjOrder } = require('../_lib/cj-fulfillment');

function clean(v,max=100){return String(v??'').trim().slice(0,max)}
module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  if(!await requireAdmin(req,res))return;
  try{
    if(req.method!=='POST')return res.status(405).json({ok:false,error:'method_not_allowed'});
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const orderId=clean(body.orderId,80).toUpperCase();
    if(!/^AH-[A-Z0-9-]{5,60}$/.test(orderId))return res.status(400).json({ok:false,error:'invalid_order_id'});
    const action=clean(body.action||'preflight',20);
    if(action==='preflight'){
      const out=await preflightCjOrder(orderId);
      await audit('cj_fulfillment_preflight','order',orderId,{ok:out.ok,reason:out.validation?.reason||null,sandbox:out.sandbox??null});
      if(!out.ok)return res.status(409).json({ok:false,error:'preflight_blocked',validation:out.validation});
      return res.status(200).json({ok:true,sandbox:out.sandbox,requestFingerprint:out.requestFingerprint,supplierOrders:out.requests.map(x=>({itemId:x.itemId,orderNumber:x.request.orderNumber,logisticName:x.request.logisticName,vid:x.request.products[0].vid,sku:x.request.products[0].sku,quantity:x.request.products[0].quantity})),liveSupplierRequestSent:false});
    }
    if(action==='execute'){
      const out=await fulfillCjOrder(orderId);
      await audit('cj_fulfillment_execute','order',orderId,{ok:out.ok,sandbox:out.sandbox??null,supplierOrderIds:out.supplierOrderIds||[],error:out.error||out.validation?.reason||null});
      if(!out.ok)return res.status(out.ambiguous?502:409).json(out);
      return res.status(200).json(out);
    }
    return res.status(400).json({ok:false,error:'invalid_action'});
  }catch(e){console.error('CJ fulfillment admin failed:',e.message);return res.status(500).json({ok:false,error:String(e.message||e).slice(0,220)});}
};
