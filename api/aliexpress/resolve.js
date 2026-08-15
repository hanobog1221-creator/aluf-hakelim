module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'method_not_allowed' });
  const url = String(req.query.url || '');
  if (!/^https:\/\/a\.aliexpress\.com\//i.test(url)) return res.status(400).json({ ok:false, error:'invalid_aliexpress_short_url' });
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' } });
    const finalUrl = r.url;
    const m = finalUrl.match(/(?:item\/|product\/)(\d+)\.html/i) || finalUrl.match(/[?&]productId=(\d+)/i);
    return res.status(200).json({ ok:true, finalUrl, productId: m ? m[1] : null, status:r.status });
  } catch (e) {
    console.error('AliExpress short link resolve failed', e);
    return res.status(500).json({ ok:false, error:'resolve_failed' });
  }
};
