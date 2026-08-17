const { APP_KEY, API_BASE, signAliExpress, readTokenRow, refreshAccessToken } = require('../_lib/aliexpress');

const PRODUCT_PATH = '/ds/product/get';

function safe(value, max = 300) {
  return String(value == null ? '' : value).slice(0, max);
}

function skuCount(json) {
  const root = json?.aliexpress_ds_product_get_response || json;
  const result = root?.result || root;
  const rows = result?.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o
    || result?.aeop_ae_product_s_k_us?.aeop_ae_product_sku
    || result?.aeop_ae_product_skus?.aeop_ae_product_sku
    || [];
  return Array.isArray(rows) ? rows.length : (rows ? 1 : 0);
}

async function productGet(productId, token) {
  const secret = process.env.ALIEXPRESS_APP_SECRET;
  const params = {
    app_key: APP_KEY,
    access_token: token,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    product_id: productId,
    ship_to_country: 'IL',
    target_currency: 'USD',
    target_language: 'EN'
  };
  params.sign = signAliExpress(params, secret, PRODUCT_PATH);
  const response = await fetch(`${API_BASE}${PRODUCT_PATH}?${new URLSearchParams(params).toString()}`, { headers: { accept: 'application/json' } });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const error = json?.error_response || null;
  const code = error?.sub_code || error?.code || (json?.code && String(json.code) !== '0' ? json.code : null);
  if (!json) return { ok:false, http:response.status, code:'non_json', message:safe(text) };
  if (!response.ok || code) return { ok:false, http:response.status, code:safe(code || `http_${response.status}`,120), message:safe(error?.sub_msg || error?.msg || json?.message || '') };
  const root = json?.aliexpress_ds_product_get_response || json;
  const result = root?.result || root;
  return { ok:true, http:response.status, skuCount:skuCount(json), title:result?.ae_item_base_info_dto?.subject || result?.subject || null, status:result?.ae_item_base_info_dto?.product_status_type || result?.product_status_type || null };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({ ok:false, error:'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'method_not_allowed' });
  const productId = String(req.query?.productId || '1005007178140659').trim();
  if (!/^\d{8,20}$/.test(productId)) return res.status(400).json({ ok:false, error:'bad_product' });
  try {
    const before = await readTokenRow();
    const beforeResult = await productGet(productId, before.access_token);
    const refreshed = await refreshAccessToken(before);
    const afterResult = await productGet(productId, refreshed.access_token);
    return res.status(200).json({
      ok:true,
      appKey:APP_KEY,
      base:API_BASE,
      path:PRODUCT_PATH,
      tokenUpdatedBefore:before.updated_at || null,
      tokenUpdatedAfter:refreshed.updated_at || null,
      before:beforeResult,
      after:afterResult
    });
  } catch (error) {
    return res.status(200).json({ ok:false, error:safe(error?.message || error,240) });
  }
};
