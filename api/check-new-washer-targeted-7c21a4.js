const { callTopApi } = require('./_lib/aliexpress');
function list(value) { return Array.isArray(value) ? value : (value ? [value] : []); }
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  try {
    const json = await callTopApi('aliexpress.ds.product.get', {
      product_id: '1005012750681706',
      ship_to_country: 'IL',
      target_currency: 'USD',
      target_language: 'EN'
    });
    const root = json.aliexpress_ds_product_get_response || json;
    const result = root.result || json.result || root;
    const base = result.ae_item_base_info_dto || result;
    const media = result.ae_multimedia_info_dto || {};
    const skus = list(result?.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o).map((sku) => ({
      id: String(sku.sku_id || ''),
      stock: sku.sku_available_stock ?? null,
      inStock: sku.sku_stock ?? null,
      price: sku.offer_sale_price ?? sku.sku_price ?? null,
      currency: sku.currency_code || null,
      properties: list(sku?.ae_sku_property_dtos?.ae_sku_property_d_t_o).map((p) => ({
        name: p.sku_property_name || p.property_name || null,
        value: p.property_value_definition_name || p.sku_property_value || null,
        image: p.sku_image || null
      }))
    }));
    return res.status(200).json({
      ok: true,
      productId: '1005012750681706',
      title: base.subject || null,
      status: base.product_status_type || result.product_status_type || null,
      images: media.image_urls || media.aeop_a_e_multimedia_image_d_t_o || null,
      skus
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: String(error.code || error.message || error).slice(0, 160) });
  }
};
