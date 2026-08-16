const crypto = require('crypto');
const { APP_KEY, getValidAccessToken } = require('../_lib/aliexpress');

const PRODUCT_ID = '1005012906553288';
const STORE_URL = 'https://aluf-hakelim-v2-ready.vercel.app/';
const GATEWAYS = [
  ['overseas_recommended', 'https://api.alibaba.com/router/rest'],
  ['overseas_alt', 'https://api.taobao.com/router/rest'],
  ['formal_https', 'https://eco.taobao.com/router/rest']
];

function formatTopTimestamp(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
}

function signTop(params, secret) {
  const payload = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => key + String(params[key]))
    .join('');
  return crypto.createHmac('md5', secret).update(payload, 'utf8').digest('hex').toUpperCase();
}

function safe(value, max = 260) {
  return String(value == null ? '' : value).slice(0, max);
}

async function callGateway(base, method, businessParams, session) {
  const secret = process.env.ALIEXPRESS_APP_SECRET;
  if (!secret) throw new Error('aliexpress_app_secret_missing');
  const params = {
    method,
    app_key: APP_KEY,
    format: 'json',
    sign_method: 'hmac',
    timestamp: formatTopTimestamp(),
    v: '2.0',
    session
  };
  for (const [key, value] of Object.entries(businessParams || {})) {
    if (value === undefined || value === null) continue;
    params[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  params.sign = signTop(params, secret);

  try {
    const response = await fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        accept: 'application/json'
      },
      body: new URLSearchParams(params).toString()
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const err = json?.error_response || null;
    if (err) {
      return {
        ok: false,
        http: response.status,
        code: safe(err.sub_code || err.code || 'error_response'),
        message: safe(err.sub_msg || err.msg || '')
      };
    }
    return {
      ok: response.ok && Boolean(json),
      http: response.status,
      keys: json ? Object.keys(json).slice(0, 8) : [],
      preview: json ? null : safe(text)
    };
  } catch (error) {
    return {
      ok: false,
      code: safe(error?.code || error?.message || 'fetch_failed'),
      cause: safe(error?.cause?.code || error?.cause?.message || '')
    };
  }
}

const TESTS = [
  ['ds.add.info', 'aliexpress.ds.add.info', {
    param0: { store_url: STORE_URL }
  }],
  ['ds.product.get', 'aliexpress.ds.product.get', {
    product_id: PRODUCT_ID,
    ship_to_country: 'IL',
    target_currency: 'USD',
    target_language: 'EN'
  }],
  ['offer.ds.product.simplequery', 'aliexpress.offer.ds.product.simplequery', {
    product_id: PRODUCT_ID,
    local_country: 'IL',
    local_language: 'en'
  }],
  ['findaeproductbyidfordropshipper', 'aliexpress.postproduct.redefining.findaeproductbyidfordropshipper', {
    product_id: PRODUCT_ID,
    local_country: 'IL',
    local_language: 'en'
  }],
  ['logistics.buyer.freight.calculate', 'aliexpress.logistics.buyer.freight.calculate', {
    param_aeop_freight_calculate_for_buyer_d_t_o: {
      country_code: 'IL',
      product_id: Number(PRODUCT_ID),
      product_num: 1,
      send_goods_country_code: 'CN'
    }
  }]
];

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const session = await getValidAccessToken();
  const gateways = [];
  for (const [gateway, base] of GATEWAYS) {
    const tests = [];
    for (const [name, method, params] of TESTS) {
      tests.push({ name, ...(await callGateway(base, method, params, session)) });
    }
    gateways.push({ gateway, tests });
  }
  return res.status(200).json({ ok: true, appKey: APP_KEY, gateways });
};
