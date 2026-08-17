const { callTopApi } = require('./_lib/aliexpress');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const json = await callTopApi('aliexpress.logistics.buyer.freight.calculate', {
      param_aeop_freight_calculate_for_buyer_d_t_o: JSON.stringify({
        country_code: 'IL', product_id: 1005012832500138, product_num: 1, send_goods_country_code: 'CN'
      })
    });
    const root = json?.aliexpress_logistics_buyer_freight_calculate_response || {};
    const result = root?.result || {};
    const summary = {};
    for (const [key, value] of Object.entries(result)) {
      summary[key] = Array.isArray(value) ? { type: 'array', length: value.length, firstKeys: Object.keys(value[0] || {}) }
        : value && typeof value === 'object' ? { type: 'object', keys: Object.keys(value) }
        : { type: typeof value };
    }
    return res.status(200).json({ ok: true, rootKeys: Object.keys(root), resultShape: summary });
  } catch (error) {
    return res.status(502).json({ ok: false, code: String(error.code || error.message).slice(0, 100) });
  }
};
