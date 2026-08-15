module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ok:false,error:'method_not_allowed'});
  const productId = String(req.query.productId || '');
  const needle = String(req.query.needle || '').slice(0,80);
  if (!/^\d{8,20}$/.test(productId)) return res.status(400).json({ok:false,error:'invalid_product_id'});
  try {
    const url = `https://www.aliexpress.com/item/${productId}.html`;
    const r = await fetch(url, {headers:{'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1','accept-language':'en-US,en;q=0.9'}});
    const html = await r.text();
    const hits=[];
    const terms = [needle, 'skuId', 'sku_id', 'skuAttr', 'skuProperty', 'Set 1', 'Battery 1 Charger 1'].filter(Boolean);
    for (const term of terms) {
      let i=0,c=0;
      while ((i=html.toLowerCase().indexOf(term.toLowerCase(),i))>=0 && c<12) {
        hits.push({term, snippet:html.slice(Math.max(0,i-350), Math.min(html.length,i+700))});
        i += term.length; c++;
      }
    }
    return res.status(200).json({ok:true,status:r.status,length:html.length,hits});
  } catch(e) {
    console.error('AliExpress scrape failed',e);
    return res.status(500).json({ok:false,error:String(e.message||e)});
  }
};
