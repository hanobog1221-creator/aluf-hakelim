module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ok:false,error:'method_not_allowed'});
  const shortUrl = String(req.query.url || '');
  const needle = String(req.query.needle || '').slice(0,80);
  if (!/^https:\/\/a\.aliexpress\.com\//i.test(shortUrl)) return res.status(400).json({ok:false,error:'invalid_aliexpress_short_url'});
  try {
    const r = await fetch(shortUrl, {redirect:'follow', headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.9'}});
    const html = await r.text();
    const hits=[];
    const terms = [needle, 'skuId', 'sku_id', 'skuAttr', 'skuProperty', 'Set 1', 'Battery 1 Charger 1'].filter(Boolean);
    for (const term of terms) {
      let i=0,c=0;
      while ((i=html.toLowerCase().indexOf(term.toLowerCase(),i))>=0 && c<20) {
        hits.push({term, snippet:html.slice(Math.max(0,i-500), Math.min(html.length,i+1200))});
        i += term.length; c++;
      }
    }
    return res.status(200).json({ok:true,status:r.status,finalUrl:r.url,length:html.length,hits});
  } catch(e) {
    console.error('AliExpress scrape failed',e);
    return res.status(500).json({ok:false,error:String(e.message||e)});
  }
};
