function htmlDecode(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function matchMeta(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i')
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return htmlDecode(m[1]);
  }
  return null;
}

function snippetAround(html, needle, radius = 500) {
  const lower = html.toLowerCase();
  const idx = lower.indexOf(String(needle).toLowerCase());
  if (idx < 0) return null;
  return html.slice(Math.max(0, idx - radius), Math.min(html.length, idx + String(needle).length + radius));
}

function extractJsonScript(html, id) {
  const re = new RegExp(`<script[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i');
  const m = html.match(re);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function deepFind(obj, wanted, out = [], path = '$', depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 12 || out.length >= 40) return out;
  for (const [key, value] of Object.entries(obj)) {
    const nextPath = `${path}.${key}`;
    if (wanted.some((w) => key.toLowerCase().includes(w))) {
      let preview = value;
      try {
        if (typeof value === 'object') preview = JSON.stringify(value).slice(0, 1400);
      } catch {}
      out.push({ path: nextPath, value: typeof preview === 'string' ? preview.slice(0, 1400) : preview });
      if (out.length >= 40) return out;
    }
    if (value && typeof value === 'object') deepFind(value, wanted, out, nextPath, depth + 1);
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const productId = String(req.query?.productId || '').trim();
  if (!/^\d{8,20}$/.test(productId)) return res.status(400).json({ ok: false, error: 'bad_product_id' });

  const url = `https://www.aliexpress.com/item/${productId}.html?gatewayAdapt=glo2isr`;
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
        'accept-language': 'en-US,en;q=0.9,he;q=0.8',
        accept: 'text/html,application/xhtml+xml',
        cookie: 'aep_usuc_f=site=glo&c_tp=ILS&region=IL&b_locale=en_US; intl_locale=en_US'
      }
    });
    const html = await response.text();
    const nextData = extractJsonScript(html, '__NEXT_DATA__');
    const findings = nextData ? deepFind(nextData, ['price', 'sku', 'ship', 'freight', 'delivery', 'stock']) : [];
    const markers = ['skuPriceList','skuModule','priceModule','freight','delivery','productSKUPropertyList','skuAttr','window.runParams','__NEXT_DATA__','__AER_DATA__'];
    const snippets = {};
    for (const marker of markers) {
      const s = snippetAround(html, marker, 380);
      if (s) snippets[marker] = s;
    }
    return res.status(200).json({
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentLength: html.length,
      title: matchMeta(html, 'og:title') || matchMeta(html, 'twitter:title'),
      metaPriceAmount: matchMeta(html, 'product:price:amount'),
      metaPriceCurrency: matchMeta(html, 'product:price:currency'),
      markers: Object.fromEntries(markers.map((m) => [m, html.toLowerCase().includes(m.toLowerCase())])),
      nextDataFindings: findings,
      snippets
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: 'public_product_fetch_failed', detail: String(error.message || error).slice(0, 300) });
  }
};
