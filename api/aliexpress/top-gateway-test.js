const { APP_KEY, TOP_API_BASE, callTopApi } = require('../_lib/aliexpress');

function safeError(error) {
  return {
    code: String(error?.code || error?.message || 'unknown_error').slice(0, 120),
    message: String(error?.details || error?.message || '').slice(0, 300)
  };
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

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({ ok: false, error: 'not_found' });
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const productId = String(req.query?.productId || '1005007178140659').trim();
  if (!/^\d{8,20}$/.test(productId)) return res.status(400).json({ ok: false, error: 'bad_product' });
  try {
    const json = await callTopApi('aliexpress.ds.product.get', {
      product_id: productId,
      ship_to_country: 'IL',
      target_currency: 'USD',
      target_language: 'EN'
    }, { reportStore: false });
    const root = json?.aliexpress_ds_product_get_response || json;
    const result = root?.result || root;
    return res.status(200).json({
      ok: true,
      appKey: APP_KEY,
      gateway: TOP_API_BASE,
      method: 'aliexpress.ds.product.get',
      productId,
      skuCount: skuCount(json),
      title: result?.ae_item_base_info_dto?.subject || result?.subject || null,
      status: result?.ae_item_base_info_dto?.product_status_type || result?.product_status_type || null
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      appKey: APP_KEY,
      gateway: TOP_API_BASE,
      method: 'aliexpress.ds.product.get',
      productId,
      error: safeError(error)
    });
  }
};
