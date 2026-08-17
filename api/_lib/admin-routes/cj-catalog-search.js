const { requireAdmin } = require('../admin');
const { ensureAccessToken, CJ_BASE } = require('../cj');

function clean(value, max = 300) { return String(value ?? '').trim().slice(0, max); }

async function cjGet(path) {
  const token = await ensureAccessToken();
  const response = await fetch(`${CJ_BASE}${path}`, {
    headers: { Accept: 'application/json', 'CJ-Access-Token': token }
  });
  const raw = await response.text();
  let json = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { json = { message: raw.slice(0, 300) }; }
  const code = Number(json?.code);
  if (!response.ok || json?.result === false || json?.success === false || (Number.isFinite(code) && ![0, 200].includes(code))) {
    throw new Error(`cj_${json?.code || response.status}_${clean(json?.message || 'failed', 180)}`);
  }
  return json;
}

function flattenListV2(json) {
  const groups = Array.isArray(json?.data?.content) ? json.data.content : [];
  return groups.flatMap((group) => Array.isArray(group?.productList) ? group.productList : []);
}

function safeProduct(row) {
  return {
    pid: clean(row?.id, 200),
    name: clean(row?.nameEn || row?.name, 300),
    sku: clean(row?.sku || row?.spu, 200),
    image: clean(row?.bigImage, 800),
    sellPrice: row?.sellPrice == null ? null : Number(row.sellPrice),
    nowPrice: row?.nowPrice == null ? null : Number(row.nowPrice),
    inventory: Number(row?.warehouseInventoryNum || 0),
    verifiedInventory: Number(row?.totalVerifiedInventory || 0),
    category: clean(row?.threeCategoryName, 200),
    saleStatus: clean(row?.saleStatus, 20),
    authorityStatus: clean(row?.authorityStatus, 20),
    productType: clean(row?.productType, 80)
  };
}

function safeVariant(row) {
  return {
    vid: clean(row?.vid, 200),
    pid: clean(row?.pid, 200),
    name: clean(row?.variantNameEn || row?.variantName, 300),
    sku: clean(row?.variantSku, 200),
    key: clean(row?.variantKey, 300),
    image: clean(row?.variantImage, 800),
    price: row?.variantSellPrice == null ? null : Number(row.variantSellPrice),
    weight: row?.variantWeight == null ? null : Number(row.variantWeight)
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!await requireAdmin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  try {
    const pid = clean(req.query?.pid, 200);
    if (pid) {
      const json = await cjGet(`/product/variant/query?pid=${encodeURIComponent(pid)}`);
      const variants = Array.isArray(json?.data) ? json.data.map(safeVariant) : [];
      return res.status(200).json({ ok: true, pid, variants });
    }
    const q = clean(req.query?.q, 180);
    if (!q) return res.status(400).json({ ok: false, error: 'query_required' });
    const json = await cjGet(`/product/listV2?page=1&size=12&keyWord=${encodeURIComponent(q)}&startWarehouseInventory=1&verifiedWarehouse=1&orderBy=0`);
    const products = flattenListV2(json).map(safeProduct);
    return res.status(200).json({ ok: true, q, products });
  } catch (error) {
    return res.status(500).json({ ok: false, error: clean(error.message || error, 240) });
  }
};
