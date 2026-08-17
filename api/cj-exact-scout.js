const { ensureAccessToken, CJ_BASE } = require('./_lib/cj');

const SEARCHES = {
  socket: ['46pcs socket wrench set black','black 46pcs ratchet socket set','46pcs tool set black ratchet'],
  impact: ['Makita 18V impact wrench body only','impact wrench for Makita battery no battery','brushless impact wrench Makita 18V bare tool'],
  washer: ['pressure washer for Makita battery body only','cordless pressure washer Makita no battery','Makita battery pressure washer bare tool'],
  ratchet: ['cordless ratchet Makita 18V body only','electric ratchet for Makita battery bare tool','90 degree ratchet Makita battery no battery'],
  bits: ['25pcs S2 impact bits 50mm','25 piece S2 screwdriver bits 50mm','S2 magnetic bit set 50mm 25'],
  charger: ['6 in 1 car charger digital voltage display','multi USB car charger 6 port voltage display','car charger 6 USB digital display'],
  obd: ['V519 automotive scanner','V519 OBD2 code reader','V519 car diagnostic tool']
};
function clean(v){return v===null||v===undefined?'':String(v).trim()}
function norm(v){return clean(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function tok(v){return new Set(norm(v).split(/\s+/).filter(x=>x.length>1))}
function score(q,p){const a=tok(q),b=tok(`${p.nameEn||''} ${p.sku||''}`);let h=0;for(const t of a)if(b.has(t))h++;return a.size?h/a.size:0}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
let lastCall=0;
async function get(path,token){const wait=Math.max(0,1150-(Date.now()-lastCall));if(wait)await sleep(wait);lastCall=Date.now();const r=await fetch(`${CJ_BASE}${path}`,{headers:{Accept:'application/json','CJ-Access-Token':token}});const txt=await r.text();let j={};try{j=txt?JSON.parse(txt):{}}catch{j={message:txt.slice(0,200)}};if(!r.ok||j.result===false||j.success===false||(j.code!=null&&![0,200].includes(Number(j.code))))throw new Error(`cj_${j.code||r.status}_${clean(j.message)||'failed'}`);return j}
function flatten(j){const out=[];for(const g of (j?.data?.content||[]))for(const p of (g?.productList||[]))out.push(p);return out}
module.exports=async function handler(req,res){res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');if(req.method!=='GET')return res.status(405).json({ok:false});try{const token=await ensureAccessToken();const result={};for(const [key,queries] of Object.entries(SEARCHES)){const m=new Map();for(const q of queries){const j=await get(`/product/listV2?page=1&size=40&keyWord=${encodeURIComponent(q)}&orderBy=0`,token);for(const p of flatten(j)){const id=clean(p.id);if(!id)continue;const s=score(q,p);const row={id,nameEn:clean(p.nameEn),sku:clean(p.sku||p.spu),image:clean(p.bigImage),sellPrice:clean(p.sellPrice||p.nowPrice),inventory:Number(p.warehouseInventoryNum||0),verified:Number(p.totalVerifiedInventory||0),listed:Number(p.listedNum||0),score:Number(s.toFixed(3)),query:q};const prev=m.get(id);if(!prev||row.score>prev.score)m.set(id,row)}}result[key]=[...m.values()].sort((a,b)=>b.score-a.score||b.verified-a.verified||b.listed-a.listed).slice(0,12)}return res.status(200).json({ok:true,result})}catch(e){return res.status(500).json({ok:false,error:e.message})}}
