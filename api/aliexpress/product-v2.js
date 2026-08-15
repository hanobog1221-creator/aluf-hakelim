const crypto = require('crypto');

function sign(params, secret, path) {
  const keys = Object.keys(params).filter(k => k !== 'sign' && params[k] !== undefined && params[k] !== null && String(params[k]) !== '').sort();
  let payload = path;
  for (const key of keys) payload += key + String(params[key]);
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex').toUpperCase();
}

async function token() {
  const u = process.env.SUPABASE_URL;
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${u.replace(/\/$/,'')}/rest/v1/aliexpress_tokens?account_key=eq.primary&select=access_token&limit=1`, {headers:{apikey:k,Authorization:`Bearer ${k}`}});
  if (!r.ok) throw new Error(`token_read_${r.status}`);
  const rows = await r.json();
  if (!rows[0]?.access_token) throw new Error('missing_token');
  return rows[0].access_token;
}

module.exports = async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false});
  const productId=String(req.query.productId||'');
  if(!/^\d{8,20}$/.test(productId)) return res.status(400).json({ok:false,error:'bad_product'});
  try{
    const appKey=process.env.ALIEXPRESS_APP_KEY||'542860';
    const secret=process.env.ALIEXPRESS_APP_SECRET;
    const accessToken=await token();
    const probes=[
      {path:'/ds/product/get',extra:{ship_to_country:'IL',target_currency:'USD',target_language:'EN'}},
      {path:'/offer/ds/product/simplequery',extra:{}},
      {path:'/postproduct/redefining/findaeproductbyidfordropshipper',extra:{}},
      {path:'/ds/product/simplequery',extra:{}}
    ];
    const results=[];
    for(const probe of probes){
      const path=probe.path;
      const params={app_key:appKey,access_token:accessToken,timestamp:String(Date.now()),sign_method:'sha256',product_id:productId,...probe.extra};
      params.sign=sign(params,secret,path);
      const url=`https://api-sg.aliexpress.com/rest${path}?${new URLSearchParams(params).toString()}`;
      const r=await fetch(url,{headers:{accept:'application/json'}});
      const text=await r.text();
      results.push({path,status:r.status,body:text.slice(0,8000)});
    }
    return res.status(200).json({ok:true,results});
  }catch(e){
    console.error('product-v2',e);
    return res.status(500).json({ok:false,error:String(e.message||e)});
  }
};
