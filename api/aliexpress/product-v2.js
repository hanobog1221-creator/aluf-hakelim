const { APP_KEY, API_BASE, signAliExpress, getValidAccessToken } = require('../_lib/aliexpress');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });

  const productId = String(req.query.productId || '');
  if (!/^\d{8,20}$/.test(productId)) {
    return res.status(400).json({ ok: false, error: 'bad_product' });
  }

  try {
    const secret = process.env.ALIEXPRESS_APP_SECRET;
    if (!secret) throw new Error('aliexpress_app_secret_missing');

    const accessToken = await getValidAccessToken();
    const probes = [
      { path: '/ds/product/get', extra: { ship_to_country: 'IL', target_currency: 'USD', target_language: 'EN' } },
      { path: '/offer/ds/product/simplequery', extra: {} },
      { path: '/postproduct/redefining/findaeproductbyidfordropshipper', extra: {} },
      { path: '/ds/product/simplequery', extra: {} }
    ];

    const results = [];
    for (const probe of probes) {
      const path = probe.path;
      const params = {
        app_key: APP_KEY,
        access_token: accessToken,
        timestamp: String(Date.now()),
        sign_method: 'sha256',
        product_id: productId,
        ...probe.extra
      };
      params.sign = signAliExpress(params, secret, path);

      const url = `${API_BASE}${path}?${new URLSearchParams(params).toString()}`;
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      const text = await response.text();
      results.push({ path, status: response.status, body: text.slice(0, 8000) });
    }

    return res.status(200).json({ ok: true, results });
  } catch (error) {
    console.error('product-v2', error);
    return res.status(500).json({ ok: false, error: String(error.message || error) });
  }
};
