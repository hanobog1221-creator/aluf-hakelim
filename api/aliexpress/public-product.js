function extractScripts(html) {
  const out = [];
  const re = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 40) out.push(m[1]);
  return out;
}

function snippets(html, needles) {
  const lower = String(html || '').toLowerCase();
  const out = {};
  for (const needle of needles) {
    const idx = lower.indexOf(String(needle).toLowerCase());
    if (idx >= 0) out[needle] = html.slice(Math.max(0, idx - 500), Math.min(html.length, idx + 1200));
  }
  return out;
}

function isPunish(html) {
  const text = String(html || '').toLowerCase();
  return text.includes('/_____tmd_____/punish') || text.includes('x5secdata=');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const productId = String(req.query?.productId || '').trim();
  if (!/^\d{8,20}$/.test(productId)) return res.status(400).json({ ok: false, error: 'bad_product_id' });

  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36'
  ];

  const attempts = [];
  let chosen = null;
  for (let i = 0; i < agents.length; i += 1) {
    const url = `https://www.aliexpress.com/item/${productId}.html?gatewayAdapt=glo2isr&_=${Date.now()}${i}`;
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: {
          'user-agent': agents[i],
          'accept-language': 'en-US,en;q=0.9,he;q=0.8',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          referer: 'https://www.aliexpress.com/',
          cookie: 'aep_usuc_f=site=glo&c_tp=ILS&region=IL&b_locale=en_US; intl_locale=en_US'
        }
      });
      const html = await response.text();
      const punished = isPunish(html);
      attempts.push({ status: response.status, length: html.length, punished, finalUrl: response.url });
      if (!punished && html.length > 10000) {
        chosen = { response, html };
        break;
      }
    } catch (error) {
      attempts.push({ error: String(error.message || error).slice(0, 200) });
    }
  }

  if (!chosen) return res.status(200).json({ ok: false, error: 'aliexpress_public_page_challenged', attempts });

  const { response, html } = chosen;
  const needles = [productId, 'mtop', 'api.', 'itemDetail', 'productDetail', 'price', 'sku', 'delivery', 'shipping', 'freight', 'apollo', 'dataSource'];
  return res.status(200).json({
    ok: true,
    status: response.status,
    finalUrl: response.url,
    length: html.length,
    attempts,
    scripts: extractScripts(html),
    snippets: snippets(html, needles)
  });
};
