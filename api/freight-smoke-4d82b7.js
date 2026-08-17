const { callTopApi } = require('./_lib/aliexpress');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const json = await callTopApi('aliexpress.ds.product.get', {
      product_id: '1005012832500138', ship_to_country: 'IL', target_currency: 'USD', target_language: 'EN'
    });
    const result = json?.aliexpress_ds_product_get_response?.result || {};
    const rows = result?.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o || [];
    const first = Array.isArray(rows) ? rows[0] : rows;
    const types = {};
    for (const key of Object.keys(first || {})) types[key] = typeof first[key];
    return res.status(200).json({ ok: true, skuKeys: Object.keys(first || {}), fieldTypes: types });
  } catch (error) {
    return res.status(502).json({ ok: false, code: String(error.code || error.message).slice(0, 120) });
  }
};
