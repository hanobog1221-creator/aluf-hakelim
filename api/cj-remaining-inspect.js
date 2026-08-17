const { ensureAccessToken, CJ_BASE } = require('./_lib/cj');

const TARGETS = [
  {key:'socket-a',store:'socket',pid:'2007005284149915650'},
  {key:'socket-b',store:'socket',pid:'1367467931776192512'},
  {key:'socket-c',store:'socket',pid:'2002312103465422850'},
  {key:'impact-a',store:'impact',pid:'2044610138992828418'},
  {key:'impact-b',store:'impact',pid:'2049735078100901889'},
  {key:'impact-c',store:'impact',pid:'2021071323890503682'},
  {key:'ratchet-a',store:'ratchet',pid:'1461879987874435072'},
  {key:'charger-a',store:'ae-1005009577109019',pid:'3509F198-F098-41C1-A23D-CBE9DCE33C2B'},
  {key:'washer-a',store:'washer',pid:'1970698889172672514'},
  {key:'bits-a',store:'ae-1005012832500138',pid:'1553565557251911680'}
];

function clean(v,max=1000){return String(v??'').trim().slice(0,max)}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
let last=0;
async function call(path,token){
  const wait=Math.max(0,1150-(Date.now()-last));if(wait)await sleep(wait);last=Date.now();
  const r=await fetch(`${CJ_BASE}${path}`,{headers:{Accept:'application/json','CJ-Access-Token':token}});
  const raw=await r.text();let j={};try{j=raw?JSON.parse(raw):{}}catch{j={message:raw.slice(0,300)}}
  const code=Number(j?.code);if(!r.ok||j?.result===false||j?.success===false||(Number.isFinite(code)&&![0,200].includes(code)))throw new Error(`cj_${j?.code||r.status}_${clean(j?.message||'failed',180)}`);
  return j;
}
function slimProp(p){return {key:clean(p?.key||p?.name||p?.propertyName,120),value:clean(p?.value||p?.propertyValue||p?.valueName,260)}}
function slimVariant(v){return {vid:clean(v?.vid,120),variantSku:clean(v?.variantSku,180),variantKey:clean(v?.variantKey,260),variantNameEn:clean(v?.variantNameEn,300),variantSellPrice:Number(v?.variantSellPrice||0),variantWeight:Number(v?.variantWeight||0),variantImage:clean(v?.variantImage,800)}}
module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});
  try{
    const token=await ensureAccessToken();const results=[];
    for(const target of TARGETS){
      try{
        const detail=await call(`/product/query?pid=${encodeURIComponent(target.pid)}`,token);
        const variants=await call(`/product/variant/query?pid=${encodeURIComponent(target.pid)}`,token);
        const stock=await call(`/product/stock/getInventoryByPid?pid=${encodeURIComponent(target.pid)}`,token);
        const d=detail?.data||{};const vs=Array.isArray(variants?.data)?variants.data:[];const inventories=stock?.data?.inventories||stock?.data||[];
        results.push({...target,detail:{nameEn:clean(d.productNameEn,400),sku:clean(d.productSku,160),bigImage:clean(d.bigImage,800),description:clean(d.description||d.productDescription||d.productNameEn,1200),weight:Number(d.productWeight||0),category:clean(d.categoryName,200),properties:(Array.isArray(d.productProEnSet)?d.productProEnSet:[]).slice(0,30).map(slimProp)},variants:vs.slice(0,80).map(slimVariant),inventory:Array.isArray(inventories)?inventories.slice(0,30):inventories});
      }catch(e){results.push({...target,error:clean(e.message,240)})}
    }
    return res.status(200).json({ok:true,results});
  }catch(e){return res.status(500).json({ok:false,error:clean(e.message,240)})}
};
