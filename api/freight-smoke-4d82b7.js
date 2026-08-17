const { callTopApi } = require('./_lib/aliexpress');
const { quoteAliExpressFreight } = require('./_lib/shipping');
const productModule = require('./aliexpress/product-v2');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const productId = '1005012832500138';
    const json = await callTopApi('aliexpress.ds.product.get', {
      product_id: productId, ship_to_country: 'IL', target_currency: 'USD', target_language: 'EN'
    });
    const root = json?.aliexpress_ds_product_get_response || json;
    const snapshot = productModule._test.snapshotFromResult(productId, root?.result || root, 'smoke');
    const sku = snapshot.skus.find((row) => row.inStock !== false);
    if (!sku) throw new Error('no_available_sku');
    const quote = await quoteAliExpressFreight({ productId, skuId: sku.id, qty: 1, countryCode: 'IL', shipFromCountry: 'CN' });
    return res.status(200).json({ ok: true, shippingAvailable: Boolean(quote), currencyPresent: Boolean(quote?.currency), servicePresent: Boolean(quote?.serviceName) });
  } catch (error) {
    return res.status(502).json({ ok: false, code: String(error.code || error.message).slice(0, 120) });
  }
};
