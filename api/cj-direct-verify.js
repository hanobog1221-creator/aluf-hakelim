const { ensureAccessToken, CJ_BASE } = require('./_lib/cj');

const MATCHES = [
  { key:'angle', storeProductId:'ae-1005007178140659', pid:'6C81E58E-F4B1-45B1-ABB0-3B12B490182D', expected:'105 Degree Right Angle Driver' },
  { key:'carplay', storeProductId:'ae-1005009926657110', pid:'2503111114131628100', expected:'Portable 2 In 1 Wireless Carplay Box Android Auto Adapter' },
  { key:'v519', storeProductId:'ae-1005010757861759', pid:'2601010937011621800', expected:'V519 OBD Car Diagnostic Scanner For Reading Codes' },
  { key:'socket_alt', storeProductId:'socket', pid:'1625330057726144512', expected:'Socket Ratchet Wrench Set Repair Tools' },
  { key:'impact_nobattery', storeProductId:'impact', pid:'2021070965732573185', expected:'Cordless Electric Impact Wrench No Battery' }
];

function clean(v){return v===null||v===undefined?'':String(v).trim()}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
let last=0;
async function req(path,token,{method='GET',body}={}){
  const wait=Math.max(0,1100-(Date.now()-last)); if(wait) await sleep(wait); last=Date.now();
  const headers={Accept:'application/json','CJ-Access-Token':token}; if(body!==undefined)headers['Content-Type']='application/json';
  const r=await fetch(`${CJ_BASE}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const txt=await r.text();let j={};try{j=txt?JSON.parse(txt):{}}catch{j={message:txt.slice(0,300)}};
  if(!r.ok||j.result===false||j.success===false||(j.code!=null&&![0,200].includes(Number(j.code))))throw new Error(`cj_${j.code||r.status}_${clean(j.message)||'failed'}`.slice(0,300));
  return j;
}
function freightRows(data){
  const arr=Array.isArray(data)?data:Array.isArray(data?.list)?data.list:Array.isArray(data?.freightList)?data.freightList:Array.isArray(data?.logisticList)?data.logisticList:[];
  return arr.map(x=>({logisticName:clean(x.logisticName||x.logisticsName||x.enName),logisticPrice:Number(x.logisticPrice??x.shippingCost??x.price??0),logisticAging:clean(x.logisticAging||x.logisticsTimeliness||x.aging),taxesFee:Number(x.taxesFee||0),clearanceFee:Number(x.clearanceFee||0)})).filter(x=>x.logisticName&&Number.isFinite(x.logisticPrice)).sort((a,b)=>a.logisticPrice-b.logisticPrice);
}
async function verify(m,token){
  const detail=await req(`/product/query?pid=${encodeURIComponent(m.pid)}`,token);
  const variants=await req(`/product/variant/query?pid=${encodeURIComponent(m.pid)}`,token);
  const stock=await req(`/product/stock/getInventoryByPid?pid=${encodeURIComponent(m.pid)}`,token);
  const list=Array.isArray(variants.data)?variants.data:[];
  const origin=(stock.data?.inventories||[]).find(x=>Number(x.totalInventoryNum||0)>0)?.countryCode||'CN';
  const verified=[];
  for(const v of list.slice(0,20)){
    let freight={};
    try{freight=await req('/logistic/freightCalculate',token,{method:'POST',body:{startCountryCode:origin,endCountryCode:'IL',products:[{quantity:1,vid:String(v.vid)}]}})}catch(e){freight={error:e.message}}
    verified.push({vid:clean(v.vid),variantKey:clean(v.variantKey),variantNameEn:clean(v.variantNameEn),variantSku:clean(v.variantSku),variantSellPrice:Number(v.variantSellPrice||0),variantWeight:Number(v.variantWeight||0),variantImage:clean(v.variantImage),freight:freight.error?{error:freight.error}:freightRows(freight.data)});
  }
  return {...m,nameEn:clean(detail.data?.productNameEn),spu:clean(detail.data?.productSku),bigImage:clean(detail.data?.bigImage),properties:detail.data?.productProEnSet||[],origin,inventory:stock.data?.inventories||[],variants:verified};
}
module.exports=async function handler(req,res){res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});try{const token=await ensureAccessToken();const results=[];for(const m of MATCHES){try{results.push(await verify(m,token))}catch(e){results.push({...m,error:e.message})}}return res.status(200).json({ok:true,results})}catch(e){return res.status(500).json({ok:false,error:e.message})}}
