const { serverConfig, serverHeaders } = require('./_lib/supabase-server');
const { CJ_BASE, ensureAccessToken, createSourcing, querySourcing } = require('./_lib/cj');
const { requireWorker } = require('./_lib/cj-worker-auth');

const DAILY_LIMIT_ERROR = 'cj_api_1600000_Exceeded the daily source limit';
const VERIFIED = new Set(['verified','verified_direct_catalog','direct_catalog_verified','verified_sync','verified_sourcing','sourcing_verified','quote_ready','ready']);
const IMAGE_FALLBACK = { '1005012879937902':'https://i.ebayimg.com/images/g/~5AAAOSwX05h7pN9/s-l1600.jpg' };
let lastCj = 0;
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const day=(v=Date.now())=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):''};

async function throttle(){const wait=Math.max(0,1150-(Date.now()-lastCj));if(wait)await sleep(wait);lastCj=Date.now();}
async function cj(path,{method='GET',body}={}){
  await throttle();
  const token=await ensureAccessToken();
  const headers={Accept:'application/json','CJ-Access-Token':token};if(body!==undefined)headers['Content-Type']='application/json';
  const r=await fetch(`${CJ_BASE}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const raw=await r.text();let j={};try{j=raw?JSON.parse(raw):{}}catch{j={message:raw.slice(0,250)}};
  const code=Number(j?.code);if(!r.ok||j?.success===false||j?.result===false||(Number.isFinite(code)&&![0,200].includes(code)))throw new Error(`cj_api_${j?.code||r.status}_${clean(j?.message||'failed',180)}`);return j;
}
async function dbGet(path){const{supabaseUrl}=serverConfig();const r=await fetch(`${supabaseUrl}/rest/v1/${path}`,{headers:serverHeaders()});if(!r.ok)throw new Error(`db_get_${r.status}`);return r.json()}
async function patch(table,filter,data){const{supabaseUrl}=serverConfig();const r=await fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`,{method:'PATCH',headers:serverHeaders({'Content-Type':'application/json',Prefer:'return=representation'}),body:JSON.stringify({...data,updated_at:new Date().toISOString()})});if(!r.ok)throw new Error(`${table}_patch_${r.status}_${(await r.text()).slice(0,160)}`);return(await r.json())[0]||null}
async function getProduct(job){if(job.store_product_id){const x=await dbGet(`products?id=eq.${encodeURIComponent(job.store_product_id)}&select=*&limit=1`);if(x[0])return x[0]}const x=await dbGet(`products?supplier_product_id=eq.${encodeURIComponent(job.supplier_product_id)}&select=*&limit=1`);return x[0]||null}
function directVerified(p){return Boolean(p&&String(p.fulfillment_provider||'').toLowerCase()==='cj'&&VERIFIED.has(String(p.fulfillment_provider_status||'').toLowerCase())&&p.fulfillment_verified_at&&p.fulfillment_product_id&&p.fulfillment_variant_id&&p.fulfillment_sku)}
async function preserve(job,p){return patch('product_intake_jobs',`id=eq.${job.id}`,{status:'published',provider_status:'direct_catalog_verified',provider_product_id:p.fulfillment_product_id,provider_variant_id:p.fulfillment_variant_id,provider_variant_sku:p.fulfillment_sku,store_product_id:p.id,last_error:null,processed_at:new Date().toISOString()})}
function sourceRecord(j,id){const d=j?.data,list=Array.isArray(d)?d:(Array.isArray(d?.list)?d.list:null);if(list)return list.find(x=>String(x?.sourceId||x?.cjSourcingId||'')===String(id))||list[0]||null;return d&&typeof d==='object'?d:null}
function chooseFreight(rows){const x=(Array.isArray(rows)?rows:[]).filter(r=>Number.isFinite(Number(r?.logisticPrice))&&Number(r.logisticPrice)>=0).sort((a,b)=>Number(a.logisticPrice)-Number(b.logisticPrice));return x[0]||null}

async function syncJob(job){
  const product=await getProduct(job);if(!product)throw new Error('catalog_product_missing');
  if(directVerified(product))return preserve(job,product);
  await throttle();const src=sourceRecord(await querySourcing([String(job.provider_sourcing_id)]),job.provider_sourcing_id)||{};
  const status=clean(src.sourceStatus,40),pid=clean(src.cjProductId,120),variantSku=clean(src.cjVariantSku,180),now=new Date().toISOString();
  if(status==='5')return patch('product_intake_jobs',`id=eq.${job.id}`,{status:'failed',provider_status:'sourcing_failed',store_product_id:product.id,provider_snapshot:src,last_error:`cj_sourcing_failed_${clean(src.sourceStatusStr,120)}`,processed_at:now});
  if(!pid||!variantSku)return patch('product_intake_jobs',`id=eq.${job.id}`,{status:'awaiting_supplier_quote',provider_status:`sourcing_${status||'pending'}`,store_product_id:product.id,provider_snapshot:src,last_error:null,processed_at:now});

  const variants=await cj(`/product/variant/query?variantSku=${encodeURIComponent(variantSku)}`);const list=Array.isArray(variants.data)?variants.data:[];const v=list.find(x=>String(x?.variantSku||'')===variantSku)||list[0];
  if(!v?.vid)return patch('product_intake_jobs',`id=eq.${job.id}`,{status:'needs_supplier_mapping',provider_status:'cj_variant_lookup_pending',store_product_id:product.id,provider_product_id:pid,provider_variant_sku:variantSku,last_error:null,processed_at:now});
  const detail=(await cj(`/product/variant/queryByVid?vid=${encodeURIComponent(v.vid)}&features=enable_inventory`)).data||{};
  const inventories=Array.isArray(detail.inventories)?detail.inventories:[],origin=(inventories.find(x=>String(x?.countryCode||'').toUpperCase()==='CN')?.countryCode||inventories[0]?.countryCode||'CN').toUpperCase();
  const freight=(await cj('/logistic/freightCalculate',{method:'POST',body:{startCountryCode:origin,endCountryCode:'IL',products:[{quantity:1,vid:String(v.vid)}]}})).data||[];
  const selected=chooseFreight(freight),stock=inventories.reduce((s,x)=>s+(Number(x?.totalInventory??x?.totalInventoryNum)||0),0),quoted=Boolean(selected&&Number.isFinite(Number(detail?.variantSellPrice??v?.variantSellPrice)));
  const snap={source:src,variant:detail||v,selectedFreight:selected,freight,origin,totalInventory:stock,checkedAt:now};
  await patch('products',`id=eq.${encodeURIComponent(product.id)}`,{fulfillment_ready:false,fulfillment_provider:'cj',fulfillment_product_id:pid,fulfillment_variant_id:String(v.vid),fulfillment_sku:variantSku,fulfillment_origin_country:origin,fulfillment_logistic_name:selected?.logisticName||null,fulfillment_provider_status:quoted?'quote_ready':'mapped',fulfillment_provider_snapshot:snap,fulfillment_verified_at:quoted?now:null});
  return patch('product_intake_jobs',`id=eq.${job.id}`,{status:quoted?'needs_profit_rule':'awaiting_supplier_quote',provider_status:quoted?'cj_quote_ready':'cj_mapping_ready_quote_pending',store_product_id:product.id,provider_product_id:pid,provider_variant_id:String(v.vid),provider_variant_sku:variantSku,provider_snapshot:snap,last_error:null,processed_at:now});
}

async function retryJob(job){
  if(job.provider_sourcing_id||String(job.last_error||'')!==DAILY_LIMIT_ERROR||day(job.updated_at)>=day())return{job,attempted:false};
  const p=await getProduct(job);if(!p)throw new Error('catalog_product_missing');if(directVerified(p))return{job:await preserve(job,p),attempted:false};
  const image=clean(p.image_url,2000).length<=200?clean(p.image_url,2000):IMAGE_FALLBACK[String(job.supplier_product_id)]||'';if(!image)throw new Error('catalog_product_image_missing');
  const sku=clean(job.requested_sku_id||p.supplier_sku_id,120),label=clean(job.requested_variant_label||p.variant_label,200);
  try{await throttle();const r=await createSourcing({thirdProductId:String(job.supplier_product_id),thirdVariantId:sku,thirdProductSku:sku,productName:clean(p.name,200),productImage:image,productUrl:`https://www.aliexpress.com/item/${job.supplier_product_id}.html`,remark:clean([label&&`Variant: ${label}`,sku&&`AliExpress SKU: ${sku}`].filter(Boolean).join(' | '),200)});const sid=clean(r?.data?.cjSourcingId||r?.data?.sourceId,120);if(!sid)throw new Error('cj_sourcing_id_missing');return{job:await patch('product_intake_jobs',`id=eq.${job.id}`,{status:'awaiting_supplier_quote',provider_status:'sourcing_requested',provider_sourcing_id:sid,store_product_id:p.id,provider_product_id:null,provider_variant_id:null,provider_variant_sku:null,provider_snapshot:r?.data||{},last_error:null,attempts:Number(job.attempts||0)+1,processed_at:new Date().toISOString()}),attempted:true}}
  catch(e){return{job:await patch('product_intake_jobs',`id=eq.${job.id}`,{status:'failed',provider_status:'cj_error',store_product_id:p.id,last_error:clean(e.message,500),attempts:Number(job.attempts||0)+1,processed_at:new Date().toISOString()}),attempted:true}}
}

module.exports=async function handler(req,res){res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');try{if(!await requireWorker(req,res))return;const mode=String(req.query?.mode||'sync'),jobs=await dbGet('product_intake_jobs?select=*&order=updated_at.asc&limit=100'),results=[];for(const j of jobs.filter(x=>x.provider_sourcing_id)){try{const u=await syncJob(j);results.push({id:j.supplier_product_id,status:u?.status,providerStatus:u?.provider_status})}catch(e){results.push({id:j.supplier_product_id,error:clean(e.message,220)})}}
if(mode==='retry'){const fresh=await dbGet('product_intake_jobs?select=*&order=updated_at.asc&limit=100');for(const j of fresh.filter(x=>!x.provider_sourcing_id&&String(x.last_error||'')===DAILY_LIMIT_ERROR)){try{const o=await retryJob(j);results.push({id:j.supplier_product_id,retry:o.attempted,status:o.job?.status,error:o.job?.last_error||null})}catch(e){results.push({id:j.supplier_product_id,error:clean(e.message,220)})}}}
const rows=await dbGet('product_intake_jobs?select=status,provider_status,provider_sourcing_id,last_error');return res.status(200).json({ok:true,mode,summary:{total:rows.length,published:rows.filter(x=>x.status==='published').length,sourcing:rows.filter(x=>x.provider_sourcing_id&&x.status!=='published').length,quoteReady:rows.filter(x=>x.provider_status==='cj_quote_ready').length,dailyLimited:rows.filter(x=>String(x.last_error||'')===DAILY_LIMIT_ERROR).length,failed:rows.filter(x=>x.status==='failed').length},results})}catch(e){console.error('CJ sourcing worker:',e.message);return res.status(500).json({ok:false,error:clean(e.message,240)})}};
