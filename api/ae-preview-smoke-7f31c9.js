const { callTopApi } = require('./_lib/aliexpress');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  try {
    const json = await callTopApi('aliexpress.ds.product.get', {
      product_id: '1005012906553288',
      ship_to_country: 'IL',
      target_currency: 'USD',
      target_language: 'EN'
    });
    const root = json?.aliexpress_ds_product_get_response || {};
    const result = root?.result || {};
    const skus = result?.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o;
    return res.status(200).json({
      ok: true,
      rspCode: root?.rsp_code ?? null,
      hasResult: Boolean(root?.result),
      skuCount: Array.isArray(skus) ? skus.length : (skus ? 1 : 0)
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      code: String(error?.code || error?.message || 'unknown').slice(0, 120)
    });
  }
};
