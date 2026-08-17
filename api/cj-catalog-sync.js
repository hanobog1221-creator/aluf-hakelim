const { serverConfig, serverHeaders } = require('./_lib/supabase-server');
const { ensureAccessToken, CJ_BASE } = require('./_lib/cj');
const { convertToIls } = require('./_lib/shipping');

function clean(v,max=300){return String(v??'').trim().slice(0,max)}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
let lastCj=0;
async function cj(path,{method='GET',body}={}){
  const wait=Math.max(0,1150-(Date.now()-lastCj));if(wait)await sleep(wait);lastCj=Date.now();
  const token=await ensureAccessToken();const headers={Accept:'application/json','CJ-Access-Token':token};if(body!==undefined)headers['Content-Type']='application/json';
  const r=await fetch(`${CJ_BASE}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const raw=await r.text();let j={};try{j=raw?JSON.parse(raw):{}}catch{j={message:raw.slice(0,300)}};const code=Number(j?.code);
  if(!r.ok||j?.result===false||j?.success===false||(Number.isFinite(code)&&![0,200].includes(code)))throw new Error(`cj_${j?.code||r.status}_${clean(j?.message||'failed',180)}`);return j;
}
async function dbGet(path){const{supabaseUrl}=serverConfig();const r=await fetch(`${supabaseUrl}/rest/v1/${path}`,{headers:serverHeaders()});if(!r.ok)throw new Error(`db_get_${r.status}`);return r.json()}
async function patch(table,filter,data){const{supabaseUrl}=serverConfig();const r=await fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`,{method:'PATCH',headers:serverHeaders({'Content-Type':'application/json',Prefer:'return=representation'}),body:JSON.stringify({...data,updated_at:new Date().toISOString()})});if(!r.ok)throw new Error(`${table}_patch_${r.status}_${(await r.text()).slice(0,180)}`);return(await r.json())[0]||null}
function inventoryRows(detail){return Array.isArray(detail?.inventories)?detail.inventories:[]}
function inventoryTotal(detail){return inventoryRows(detail).reduce((s,x)=>s+(Number(x?.totalInventory??x?.totalInventoryNum)||0),0)}
function originCountry(detail){const rows=inventoryRows(detail);const cn=rows.find(x=>String(x?.countryCode||'').toUpperCase()==='CN'&&(Number(x?.totalInventory??x?.totalInventoryNum)||0)>0);if(cn)return'CN';return clean(rows.find(x=>(Number(x?.totalInventory??x?.totalInventoryNum)||0)>0)?.countryCode||'CN',2).toUpperCase()}
function freightList(data){return Array.isArray(data)?data:[]}
function chooseFreight(rows,preferred){const valid=freightList(rows).filter(x=>Number.isFinite(Number(x?.logisticPrice))&&Number(x.logisticPrice)>=0);if(preferred){const hit=valid.find(x=>clean(x?.logisticName,120).toLowerCase()===clean(preferred,120).toLowerCase());if(hit)return hit}valid.sort((a,b)=>Number(a.logisticPrice)-Number(b.logisticPrice));return valid[0]||null}
function retailAtLeast(target,current){const c=Number(current||0);if(Number.isFinite(c)&&c>=target)return Number(c.toFixed(2));return Number((Math.ceil(Number(target)*10)/10).toFixed(2))}
async function getVariant(vid){const j=await cj(`/product/variant/queryByVid?vid=${encodeURIComponent(vid)}&features=enable_inventory`);return j.data&&typeof j.data==='object'?j.data:null}
async function getFreight(vid,origin){const j=await cj('/logistic/freightCalculate',{method:'POST',body:{startCountryCode:origin,endCountryCode:'IL',products:[{quantity:1,vid:String(vid)}]}});return freightList(j.data)}
async function syncProduct(p,minProfit,job=null){
  const vid=clean(p.fulfillment_variant_id||job?.provider_variant_id,160);const sku=clean(p.fulfillment_sku||job?.provider_variant_sku,180);const pid=clean(p.fulfillment_product_id||job?.provider_product_id,180);if(!vid||!sku||!pid)throw new Error('cj_identity_incomplete');
  const detail=await getVariant(vid);if(!detail)throw new Error('cj_variant_missing');const origin=originCountry(detail);const stock=inventoryTotal(detail);const freight=await getFreight(vid,origin);const selected=chooseFreight(freight,p.fulfillment_logistic_name||job?.provider_snapshot?.selectedFreight?.logisticName);if(!selected)throw new Error('cj_shipping_to_il_unavailable');
  const priceUsd=Number(detail.variantSellPrice);const freightUsd=Number(selected.logisticPrice);if(!Number.isFinite(priceUsd)||priceUsd<0)throw new Error('cj_price_missing');
  const priceIls=await convertToIls(priceUsd,'USD'),shippingIls=await convertToIls(freightUsd,'USD');const target=priceIls+Number(minProfit||25);const sellingPrice=retailAtLeast(target,p.selling_price);const now=new Date().toISOString();const maxCost=Number((priceIls+shippingIls).toFixed(2));
  const snapshot={source:job?'cj_sourcing':'cj_sync',cjProductId:pid,cjVariantId:vid,cjVariantSku:sku,variantSellPriceUsd:priceUsd,inventory:stock,origin,freight:selected,priceIls,shippingIls,checkedAt:now};
  await patch('products',`id=eq.${encodeURIComponent(p.id)}`,{supplier:'cj',supplier_id:`cj:${pid}`,supplier_product_id:pid,supplier_sku_id:vid,supplier_price:priceUsd,supplier_currency:'USD',supplier_price_ils:priceIls,supplier_shipping:shippingIls,shipping_currency:'ILS',supplier_in_stock:stock>0,supplier_stock:stock,supplier_shipping_available:true,supplier_ship_from_country:origin,supplier_sync_error:null,shipping_sync_error:null,last_sync_at:now,shipping_last_checked_at:now,selling_price:sellingPrice,auto_fulfill_max_cost:Math.max(Number(p.auto_fulfill_max_cost||0),Number((maxCost*1.10).toFixed(2))),fulfillment_provider:'cj',fulfillment_product_id:pid,fulfillment_variant_id:vid,fulfillment_sku:sku,fulfillment_origin_country:origin,fulfillment_logistic_name:clean(selected.logisticName,120),fulfillment_provider_status:job?'verified_sourcing':'verified_sync',fulfillment_provider_snapshot:snapshot,fulfillment_verified_at:now,fulfillment_ready:false});
  const ready=stock>0&&(sellingPrice-priceIls)>=Number(minProfit||25);if(ready)await patch('products',`id=eq.${encodeURIComponent(p.id)}`,{fulfillment_ready:true});
  if(job)await patch('product_intake_jobs',`id=eq.${job.id}`,{status:ready?'published':'needs_profit_rule',provider_status:ready?'sourcing_verified':'needs_profit_rule',provider_product_id:pid,provider_variant_id:vid,provider_variant_sku:sku,provider_snapshot:snapshot,store_product_id:p.id,last_error:null,processed_at:now});
  return{id:p.id,ready,stock,priceUsd,priceIls,shippingUsd:freightUsd,shippingIls,sellingPrice,service:selected.logisticName,pid,vid,sku};
}
module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');if(process.env.VERCEL_ENV==='production')return res.status(403).json({ok:false,error:'preview_only'});if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
  try{
    const settings=(await dbGet('site_settings?id=eq.primary&select=minimum_profit_ils&limit=1'))[0]||{};const minProfit=Number(settings.minimum_profit_ils||25);const products=await dbGet('products?select=*&active=eq.true');const byId=new Map(products.map(p=>[String(p.id),p]));const jobs=await dbGet('product_intake_jobs?select=*&provider_status=eq.cj_quote_ready');const results=[];const synced=new Set();
    for(const job of jobs){const p=byId.get(String(job.store_product_id||''));if(!p)continue;try{results.push({kind:'finalize',...(await syncProduct(p,minProfit,job))});synced.add(String(p.id))}catch(e){results.push({kind:'finalize',id:p.id,error:clean(e.message,220)})}}
    for(const p of products.filter(x=>String(x.fulfillment_provider||'').toLowerCase()==='cj'&&x.fulfillment_product_id&&x.fulfillment_variant_id&&x.fulfillment_sku&&!synced.has(String(x.id)))){try{results.push({kind:'refresh',...(await syncProduct(p,minProfit,null))})}catch(e){await patch('products',`id=eq.${encodeURIComponent(p.id)}`,{fulfillment_ready:false,supplier_sync_error:clean(e.message,300)}).catch(()=>{});results.push({kind:'refresh',id:p.id,error:clean(e.message,220)})}}
    return res.status(200).json({ok:true,minProfit,results,ready:results.filter(x=>x.ready).length,errors:results.filter(x=>x.error).length});
  }catch(e){return res.status(500).json({ok:false,error:clean(e.message,240)})}
};
