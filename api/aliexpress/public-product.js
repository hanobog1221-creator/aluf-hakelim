function cleanPreview(html) {
  return String(html || '')
    .replace(/\s+/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, '<script>…</script>')
    .slice(0, 1800);
}

function markerMap(html) {
  const markers = ['skuPriceList','skuModule','priceModule','freight','delivery','productSKUPropertyList','skuAttr','window.runParams','__NEXT_DATA__','__AER_DATA__','captcha','punish','login'];
  return Object.fromEntries(markers.map((m) => [m, String(html || '').toLowerCase().includes(m.toLowerCase())]));
}

async function fetchPage(url, headers) {
  try {
    const response = await fetch(url, { redirect: 'follow', headers });
    const html = await response.text();
    return {
      requestedUrl: url,
      status: response.status,
      ok: response.ok,
      finalUrl: response.url,
      contentType: response.headers.get('content-type'),
      length: html.length,
      markers: markerMap(html),
      preview: cleanPreview(html)
    };
  } catch (error) {
    return { requestedUrl: url, ok: false, error: String(error.message || error).slice(0, 300) };
  }
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

  const urls = [
    `https://www.aliexpress.com/item/${productId}.html`,
    `https://www.aliexpress.com/item/${productId}.html?gatewayAdapt=glo2isr`,
    `https://m.aliexpress.com/item/${productId}.html`,
    `https://he.aliexpress.com/item/${productId}.html`
  ];

  const attempts = [];
  for (const url of urls) attempts.push(await fetchPage(url, headers));
  return res.status(200).json({ ok: true, productId, attempts });
};
