const { ensureAccessToken, CJ_BASE } = require('./_lib/cj');
const { serverConfig, serverHeaders } = require('./_lib/supabase-server');

const KEYWORDS = {
  '1005012879937902': ['18V electric ratchet wrench makita', 'cordless ratchet wrench 18V'],
  '1005007178140659': ['105 degree angle drill adapter', '105 degree screwdriver angle adapter'],
  '1005009577109019': ['6 in 1 car charger voltage display', 'car charger voltage display USB 6 in 1'],
  '1005010757861759': ['V519 OBD2 scanner', 'OBD2 scanner V519'],
  '1005012832500138': ['25pcs S2 magnetic screwdriver bits 50mm', 'S2 magnetic bits 50mm 25pcs'],
  '1005009926657110': ['wireless CarPlay Android Auto adapter 2 in 1', 'CarPlay Android Auto wireless adapter'],
  '1005010616492119': ['520Nm 18V impact wrench makita', 'cordless impact wrench 18V makita'],
  '1005012629074137': ['cordless pressure washer makita 18V', 'wireless pressure washer makita battery'],
  '1005012906553288': ['46pcs socket ratchet set', '46 piece socket wrench ratchet set']
};

function clean(v){ return v === null || v === undefined ? '' : String(v).trim(); }
function norm(v){ return clean(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function tokens(v){ return new Set(norm(v).split(/\s+/).filter(x => x.length >= 2)); }
function score(query, candidate){
  const q = tokens(query);
  const c = tokens([candidate.nameEn, candidate.sku, candidate.spu].filter(Boolean).join(' '));
  let hit = 0;
  for (const t of q) if (c.has(t)) hit++;
  return q.size ? hit / q.size : 0;
}

async function cjGet(path, token){
  const r = await fetch(`${CJ_BASE}${path}`, { headers: { Accept:'application/json', 'CJ-Access-Token': token } });
  const text = await r.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text.slice(0,300) }; }
  if (!r.ok || json.result === false || json.success === false || (json.code != null && ![0,200].includes(Number(json.code)))) {
    throw new Error(`cj_catalog_${json.code || r.status}_${clean(json.message) || 'failed'}`.slice(0,300));
  }
  return json;
}

function flattenListV2(json){
  const content = Array.isArray(json?.data?.content) ? json.data.content : [];
  const out = [];
  for (const group of content) {
    for (const p of (Array.isArray(group?.productList) ? group.productList : [])) out.push(p);
  }
  return out;
}

async function readCatalogProducts(){
  const { supabaseUrl } = serverConfig();
  const ids = Object.keys(KEYWORDS);
  const filter = ids.map(id => `supplier_product_id.eq.${id}`).join(',');
  const url = `${supabaseUrl}/rest/v1/products?or=(${encodeURIComponent(filter)})&select=id,name,supplier_product_id,variant_label,supplier_sku_id,supplier_price,supplier_price_ils,image_url`;
  const r = await fetch(url, { headers: serverHeaders() });
  if (!r.ok) throw new Error(`catalog_read_${r.status}`);
  return r.json();
}

module.exports = async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET') return res.status(405).json({ok:false,error:'method_not_allowed'});
  try {
    const token = await ensureAccessToken();
    const products = await readCatalogProducts();
    const results = [];
    for (const p of products) {
      const queries = KEYWORDS[String(p.supplier_product_id)] || [];
      const merged = new Map();
      for (const q of queries) {
        const path = `/product/listV2?page=1&size=20&keyWord=${encodeURIComponent(q)}&orderBy=0`;
        const json = await cjGet(path, token);
        for (const c of flattenListV2(json)) {
          const id = clean(c.id);
          if (!id) continue;
          const s = score(q,c);
          const prev = merged.get(id);
          if (!prev || s > prev.score) merged.set(id, {
            id,
            nameEn: clean(c.nameEn),
            sku: clean(c.sku || c.spu),
            image: clean(c.bigImage),
            sellPrice: clean(c.sellPrice || c.nowPrice),
            warehouseInventoryNum: Number(c.warehouseInventoryNum || 0),
            verifiedInventory: Number(c.totalVerifiedInventory || 0),
            listedNum: Number(c.listedNum || 0),
            deliveryCycle: clean(c.deliveryCycle),
            score: Number(s.toFixed(3)),
            matchedQuery: q
          });
        }
      }
      const candidates = [...merged.values()].sort((a,b)=> b.score-a.score || b.verifiedInventory-a.verifiedInventory || b.listedNum-a.listedNum).slice(0,8);
      results.push({
        storeProductId:p.id,
        supplierProductId:p.supplier_product_id,
        storeName:p.name,
        wantedVariant:p.variant_label,
        aliSku:p.supplier_sku_id,
        aliCost:p.supplier_price_ils || p.supplier_price,
        queries,
        candidates
      });
    }
    return res.status(200).json({ok:true,count:results.length,results});
  } catch (error) {
    console.error('CJ catalog scout failed:', error.message);
    return res.status(500).json({ok:false,error:error.message || 'catalog_scout_failed'});
  }
};
