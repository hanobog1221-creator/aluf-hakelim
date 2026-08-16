const { requireAdmin } = require('../_lib/admin');

function allowedAliExpressUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'aliexpress.com' || host.endsWith('.aliexpress.com'));
  } catch {
    return false;
  }
}

async function resolveAliExpressUrl(startUrl) {
  let current = new URL(startUrl).toString();
  for (let i = 0; i < 6; i += 1) {
    if (!allowedAliExpressUrl(current)) throw new Error('redirect_outside_aliexpress');
    const response = await fetch(current, {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0' }
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { finalUrl: current, status: response.status };
    }
    const location = response.headers.get('location');
    if (!location) throw new Error('redirect_missing_location');
    const next = new URL(location, current).toString();
    if (!allowedAliExpressUrl(next)) throw new Error('redirect_outside_aliexpress');
    current = next;
  }
  throw new Error('too_many_redirects');
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'method_not_allowed' });
  if (!await requireAdmin(req, res)) return;

  const url = String(req.query.url || '').trim();
  if (!/^https:\/\/a\.aliexpress\.com\//i.test(url) || !allowedAliExpressUrl(url)) {
    return res.status(400).json({ ok:false, error:'invalid_aliexpress_short_url' });
  }

  try {
    const { finalUrl, status } = await resolveAliExpressUrl(url);
    const m = finalUrl.match(/(?:item\/|product\/)(\d+)\.html/i) || finalUrl.match(/[?&]productId=(\d+)/i);
    return res.status(200).json({ ok:true, finalUrl, productId: m ? m[1] : null, status });
  } catch (error) {
    console.error('AliExpress short link resolve failed', error);
    const code = String(error.message || error);
    if (code === 'redirect_outside_aliexpress') return res.status(400).json({ ok:false, error:'unsafe_redirect' });
    if (code === 'too_many_redirects') return res.status(400).json({ ok:false, error:'too_many_redirects' });
    return res.status(500).json({ ok:false, error:'resolve_failed' });
  }
};
