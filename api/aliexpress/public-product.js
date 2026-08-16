function extractScripts(html) {
  const out = [];
  const re = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 30) out.push(m[1]);
  return out;
}

function snippets(html, needles) {
  const lower = String(html || '').toLowerCase();
  const out = {};
  for (const needle of needles) {
    const idx = lower.indexOf(String(needle).toLowerCase());
    if (idx >= 0) out[needle] = html.slice(Math.max(0, idx - 450), Math.min(html.length, idx + 900));
  }
  return out;
}

async function fetchHtml(url, headers) {
  const response = await fetch(url, { redirect: 'follow', headers });
  const html = await response.text();
  return { response, html };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const productId = String(req.query?.productId || '').trim();
  if (!/^\d{8,20}$/.test(productId)) return res.status(400).json({ ok: false, error: 'bad_product_id' });

  const headers = {
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'accept-language': 'en-US,en;q=0.9,he;q=0.8',
    accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    cookie: 'aep_usuc_f=site=glo&c_tp=ILS&region=IL&b_locale=en_US; intl_locale=en_US'
  };

  const url = `https://www.aliexpress.com/item/${productId}.html`;
  try {
    const { response, html } = await fetchHtml(url, headers);
    const needles = [productId, 'mtop', 'api.', 'itemDetail', 'productDetail', 'price', 'sku', 'delivery', 'shipping', 'freight', 'apollo', 'dataSource'];
    return res.status(200).json({
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      length: html.length,
      scripts: extractScripts(html),
      snippets: snippets(html, needles)
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: 'public_product_fetch_failed', detail: String(error.message || error).slice(0, 300) });
  }
};
