const { serverConfig, serverHeaders } = require('./_lib/supabase-server');
const { ensureAccessToken, CJ_BASE } = require('./_lib/cj');

function clean(v,max=240){return String(v??'').trim().slice(0,max)}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function api(path,{method='POST',body}={}){
  const token=await ensureAccessToken();
  const headers={Accept:'application/json','CJ-Access-Token':token};
  if(body!==undefined)headers['Content-Type']='application/json';
  const r=await fetch(`${CJ_BASE}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const raw=await r.text();let j={};try{j=raw?JSON.parse(raw):{}}catch{j={message:raw.slice(0,300)}};
  const code=Number(j?.code);
  if(!r.ok||j?.result===false||j?.success===false||(Number.isFinite(code)&&![0,200].includes(code))){
    const e=new Error(`cj_sandbox_${j?.code||r.status}_${clean(j?.message||'failed',180)}`);e.cj=j;e.status=r.status;throw e;
  }
  return j;
}
async function orderDetail(orderId){
  return api(`/shopping/order/getOrderDetail?orderId=${encodeURIComponent(orderId)}&features=LOGISTICS_TIMELINESS`,{method:'GET'});
}
function statusOf(detail){return clean(detail?.data?.orderStatus||detail?.data?.status,40).toUpperCase()}
async function waitForStatus(orderId,allowed,{tries=10,delay=1250}={}){
  let detail=null,status='';
  for(let i=0;i<tries;i++){
    detail=await orderDetail(orderId);status=statusOf(detail);
    if(allowed.includes(status))return {detail,status};
    if(i<tries-1)await sleep(delay);
  }
  throw new Error(`cj_status_timeout_${status||'unknown'}`);
}
async function latestAttempt(){
  const {supabaseUrl}=serverConfig();
  const r=await fetch(`${supabaseUrl}/rest/v1/supplier_order_attempts?provider=eq.cj&provider_sandbox=eq.true&status=eq.payment_pending&select=*&order=created_at.desc&limit=1`,{headers:serverHeaders()});
  if(!r.ok)throw new Error(`attempt_read_${r.status}`);return(await r.json())[0]||null;
}
async function patch(table,filter,data){
  const{supabaseUrl}=serverConfig();
  const r=await fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`,{method:'PATCH',headers:serverHeaders({'Content-Type':'application/json',Prefer:'return=representation'}),body:JSON.stringify({...data,updated_at:new Date().toISOString()})});
  if(!r.ok)throw new Error(`${table}_patch_${r.status}_${(await r.text()).slice(0,160)}`);return(await r.json())[0]||null;
}
module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  if(process.env.VERCEL_ENV==='production')return res.status(403).json({ok:false,error:'preview_only'});
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
  try{
    const attempt=await latestAttempt();if(!attempt)throw new Error('sandbox_payment_pending_attempt_missing');
    const ids=Array.isArray(attempt.supplier_order_ids)?attempt.supplier_order_ids:[];
    if(ids.length!==1)throw new Error('sandbox_single_order_required');
    const cjOrderId=String(ids[0]);

    let first=await orderDetail(cjOrderId);let firstStatus=statusOf(first);let confirmed=null;
    if(['CREATED','IN_CART'].includes(firstStatus)){
      try{confirmed=await api('/shopping/order/confirmOrder',{method:'PATCH',body:{orderId:cjOrderId}});}
      catch(e){
        const msg=clean(e.message,260).toLowerCase();
        if(!msg.includes('being confirmed')&&!msg.includes('try again later'))throw e;
      }
    }
    const unpaid=await waitForStatus(cjOrderId,['UNPAID']);

    const pay=await api('/shopping/sandbox/simulatePay',{body:{orderId:cjOrderId}});
    await sleep(1250);
    const paid=await waitForStatus(cjOrderId,['PENDING','PROCESSING','UNSHIPPED'],{tries:8,delay:1100});

    const unshipped=await api('/shopping/sandbox/updateStatus',{body:{orderId:cjOrderId,targetStatus:400}});
    await sleep(1150);
    const trackNumber=`SBXTN${Date.now().toString().slice(-12)}`;
    const tracking=await api('/shopping/sandbox/updateTrackNumber',{body:{orderId:cjOrderId,trackNumber}});
    await sleep(1150);
    const shipped=await api('/shopping/sandbox/updateStatus',{body:{orderId:cjOrderId,targetStatus:500}});
    await sleep(1150);
    const finalDetail=await orderDetail(cjOrderId);

    const updatedAttempt=await patch('supplier_order_attempts',`id=eq.${attempt.id}`,{
      status:'paid',provider_payment_required:true,provider_payment_completed:true,
      response:{...(attempt.response||{}),sandboxLifecycle:{initialStatus:firstStatus,confirmed:confirmed?.data||'already_confirming',unpaidStatus:unpaid.status,simulatePay:pay.data===true,paidStatus:paid.status,unshipped:unshipped.data===true,tracking:tracking.data===true,shipped:shipped.data===true,trackNumber,detail:finalDetail.data||null,completedAt:new Date().toISOString()}}
    });
    const order=await patch('orders',`order_id=eq.${encodeURIComponent(attempt.order_id)}`,{status:'shipped',fulfillment_status:'shipped',tracking_number:trackNumber,last_error:null});
    return res.status(200).json({ok:true,sandbox:true,realCharge:false,realShipment:false,cjOrderId,trackNumber,attempt:{status:updatedAttempt?.status,providerPaymentCompleted:updatedAttempt?.provider_payment_completed},order:{orderId:order?.order_id,status:order?.status,fulfillmentStatus:order?.fulfillment_status,trackingNumber:order?.tracking_number},cj:{initialStatus:firstStatus,unpaidStatus:unpaid.status,paidStatus:paid.status,pay:pay.data,unshipped:unshipped.data,tracking:tracking.data,shipped:shipped.data,orderStatus:statusOf(finalDetail),isSandbox:finalDetail.data?.isSandbox??true}});
  }catch(e){console.error('CJ sandbox lifecycle failed:',e.message);return res.status(500).json({ok:false,sandbox:true,realCharge:false,realShipment:false,error:clean(e.message,240)});}
};
