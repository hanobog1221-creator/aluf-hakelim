const { APP_KEY, API_BASE, signAliExpress, getValidAccessToken } = require('../_lib/aliexpress');

const PRODUCT_PATH = '/ds/product/get';

function skuCount(json) {
  const root = json?.aliexpress_ds_product_get_response || json;
  const result = root?.result || json?.result || root;
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
    const secret = process.env.ALIEXPRESS_APP_SECRET;
    if (!secret) throw new Error('aliexpress_app_secret_missing');
    const accessToken = await getValidAccessToken();
    const params = {
      app_key: APP_KEY,
      access_token: accessToken,
      timestamp: String(Date.now()),
      sign_method: 'sha256',
      product_id: productId,
      ship_to_country: 'IL',
      target_currency: 'USD',
      target_language: 'EN'
    };
    params.sign = signAliExpress(params, secret, PRODUCT_PATH);

    const response = await fetch(`${API_BASE}${PRODUCT_PATH}?${new URLSearchParams(params).toString()}`, {
      headers: { accept: 'application/json' }
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    const errorCode = json?.code || json?.error_response?.sub_code || json?.error_response?.code || null;
    const errorMessage = json?.message || json?.msg || json?.error_response?.sub_msg || json?.error_response?.msg || null;
    if (!response.ok || !json || errorCode) {
      return res.status(200).json({
        ok: false,
        appKey: APP_KEY,
        apiBase: API_BASE,
        apiPath: PRODUCT_PATH,
        httpMethod: 'GET',
        productId,
        httpStatus: response.status,
        errorCode: errorCode ? String(errorCode).slice(0, 160) : null,
        errorMessage: errorMessage ? String(errorMessage).slice(0, 300) : null
      });
    }

    const root = json.aliexpress_ds_product_get_response || json;
    const result = root.result || json.result || root;
    return res.status(200).json({
      ok: true,
      appKey: APP_KEY,
      apiBase: API_BASE,
      apiPath: PRODUCT_PATH,
      httpMethod: 'GET',
      productId,
      skuCount: skuCount(json),
      title: result?.ae_item_base_info_dto?.subject || result?.subject || null,
      status: result?.ae_item_base_info_dto?.product_status_type || result?.product_status_type || null
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      appKey: APP_KEY,
      apiBase: API_BASE,
      apiPath: PRODUCT_PATH,
      httpMethod: 'GET',
      productId,
      errorCode: String(error?.code || error?.message || 'unknown_error').slice(0, 160),
      errorMessage: String(error?.details || error?.message || '').slice(0, 300)
    });
  }
};
