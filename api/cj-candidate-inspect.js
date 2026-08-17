const { ensureAccessToken, CJ_BASE } = require('./_lib/cj');

const CANDIDATES = [
  { key:'angle', supplierProductId:'1005007178140659', pid:'6C81E58E-F4B1-45B1-ABB0-3B12B490182D', wanted:'105 degree 1/4 inch angle adapter' },
  { key:'socket', supplierProductId:'1005012906553288', pid:'1367467931776192512', wanted:'46pcs socket ratchet set Black-5' },
  { key:'carplay', supplierProductId:'1005009926657110', pid:'2503111114131628100', wanted:'2 in 1 wireless CarPlay Android Auto adapter' },
  { key:'impact', supplierProductId:'1005010616492119', pid:'2048944396238610434', wanted:'18V Makita compatible impact wrench body only no battery' },
  { key:'washer', supplierProductId:'1005012629074137', pid:'1970698889172672514', wanted:'cordless pressure washer body only no battery no charger' },
  { key:'ratchet', supplierProductId:'1005012879937902', pid:'1964948294503014401', wanted:'18V cordless ratchet body only no battery' }
];

function clean(v){ return v === null || v === undefined ? '' : String(v).trim(); }
function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
let lastCall = 0;
async function cjGet(path, token){
  const wait = Math.max(0, 1150 - (Date.now() - lastCall));
  if(wait) await sleep(wait);
  lastCall = Date.now();
  const r = await fetch(`${CJ_BASE}${path}`, { headers:{Accept:'application/json','CJ-Access-Token':token} });
  const txt = await r.text(); let j={}; try{j=txt?JSON.parse(txt):{}}catch{j={message:txt.slice(0,300)}}
  if(!r.ok || j.result===false || j.success===false || (j.code!=null && ![0,200].includes(Number(j.code)))) throw new Error(`cj_${j.code||r.status}_${clean(j.message)||'failed'}`);
  return j;
}

module.exports = async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8'); res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'method_not_allowed'});
  try{
    const token=await ensureAccessToken(); const out=[];
    for(const c of CANDIDATES){
      try{
        const detail = await cjGet(`/product/query?pid=${encodeURIComponent(c.pid)}`, token);
        const variants = await cjGet(`/product/variant/query?pid=${encodeURIComponent(c.pid)}`, token);
        const inventory = await cjGet(`/product/stock/getInventoryByPid?pid=${encodeURIComponent(c.pid)}`, token);
        const vd=Array.isArray(variants.data)?variants.data:[];
        out.push({
          ...c,
          detail:{
            pid:detail.data?.pid,
            nameEn:detail.data?.productNameEn,
            sku:detail.data?.productSku,
            bigImage:detail.data?.bigImage,
            images:(detail.data?.productImageSet||[]).slice(0,8),
            weight:detail.data?.productWeight,
            category:detail.data?.categoryName,
            properties:detail.data?.productProEnSet||[]
          },
          variants:vd.slice(0,60).map(v=>({
            vid:v.vid,pid:v.pid,variantNameEn:v.variantNameEn,variantKey:v.variantKey,variantSku:v.variantSku,
            variantSellPrice:v.variantSellPrice,variantWeight:v.variantWeight,variantLength:v.variantLength,variantWidth:v.variantWidth,variantHeight:v.variantHeight,
            variantImage:v.variantImage
          })),
          inventory:inventory.data||{}
        });
      }catch(e){out.push({...c,error:e.message})}
    }
    return res.status(200).json({ok:true,results:out});
  }catch(e){return res.status(500).json({ok:false,error:e.message})}
};
