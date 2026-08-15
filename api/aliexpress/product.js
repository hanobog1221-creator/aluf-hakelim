const crypto = require('crypto');

function fmtGMT8(date = new Date()) {
  const d = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const p = n => String(n).padStart(2,'0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function signHmacMd5(params, secret) {
  const base = Object.keys(params).sort().map(k => `${k}${params[k]}`).join('');
  return crypto.createHmac('md5', secret).update(base, 'utf8').digest('hex').toUpperCase();
}

async function getPrimaryToken() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/aliexpress_tokens?account_key=eq.primary&select=access_token&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  if (!r.ok) throw new Error(`token_read_failed_${r.status}`);
  const rows = await r.json();
  if (!rows[0]?.access_token) throw new Error('missing_access_token');
  return rows[0].access_token;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ok:false,error:'method_not_allowed'});
  const productId = String(req.query.productId || '');
  if (!/^\d{8,20}$/.test(productId)) return res.status(400).json({ok:false,error:'invalid_product_id'});
  try {
    const appKey = process.env.ALIEXPRESS_APP_KEY || '542860';
    const secret = process.env.ALIEXPRESS_APP_SECRET;
    const session = await getPrimaryToken();
    const params = {
      app_key: appKey,
      format: 'json',
      method: 'aliexpress.ds.product.get',
      product_id: productId,
      session,
      ship_to_country: 'IL',
      sign_method: 'hmac',
      target_currency: 'USD',
      target_language: 'EN',
      timestamp: fmtGMT8(),
      v: '2.0'
    };
    params.sign = signHmacMd5(params, secret);
    const body = new URLSearchParams(params);
    const r = await fetch('https://gw.api.taobao.com/router/rest', {
      method: 'POST',
      headers: {'Content-Type':'application/x-www-form-urlencoded;charset=utf-8'},
      body: body.toString()
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw:text.slice(0,2000) }; }
    return res.status(r.ok ? 200 : 502).json(json);
  } catch (e) {
    console.error('AliExpress product lookup failed', e);
    return res.status(500).json({ok:false,error:String(e.message||e)});
  }
};
