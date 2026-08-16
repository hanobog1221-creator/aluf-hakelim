const { callTopApi } = require('../_lib/aliexpress');

function safeError(error) {
  return {
    ok: false,
    code: String(error?.code || error?.message || error || 'unknown').slice(0, 160),
    details: String(error?.details || '').slice(0, 300)
  };
}

async function test(name, fn) {
  try {
    const result = await fn();
    return { ok: true, name, keys: Object.keys(result || {}).slice(0, 12) };
  } catch (error) {
    return { name, ...safeError(error) };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const productId = '1005012906553288';
  const tests = [];

  tests.push(await test('ds.add.info', () => callTopApi('aliexpress.ds.add.info', {
    param0: { store_url: 'https://aluf-hakelim-v2-ready.vercel.app/' }
  }, { reportStore: false })));

  tests.push(await test('ds.product.get', () => callTopApi('aliexpress.ds.product.get', {
    product_id: productId,
    ship_to_country: 'IL',
    target_currency: 'USD',
    target_language: 'EN'
  }, { reportStore: false })));

  tests.push(await test('offer.ds.product.simplequery', () => callTopApi('aliexpress.offer.ds.product.simplequery', {
    product_id: productId,
    local_country: 'IL',
    local_language: 'en'
  }, { reportStore: false })));

  tests.push(await test('logistics.buyer.freight.calculate', () => callTopApi('aliexpress.logistics.buyer.freight.calculate', {
    param_aeop_freight_calculate_for_buyer_d_t_o: JSON.stringify({
      country_code: 'IL',
      product_id: Number(productId),
      product_num: 1,
      send_goods_country_code: 'CN'
    })
  }, { reportStore: false })));

  return res.status(200).json({ ok: true, tests });
};
