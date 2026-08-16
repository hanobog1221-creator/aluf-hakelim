const { SESSION_COOKIE, parseCookies, verifyCredentials, createSession, deleteSession, requireAdmin, setSessionCookie, config, dbHeaders, audit } = require('./_lib/admin');

const ORDER_STATUSES = new Set(['draft','payment_pending','paid','processing','ordered','shipped','completed','cancelled','error']);
const FULFILLMENT_STATUSES = new Set(['not_started','waiting','ready','ordering','ordered','shipped','delivered','failed','cancelled']);

function bodyOf(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}
function cleanText(value, max, nullable = true) {
  if (value === null || value === undefined || value === '') return nullable ? null : '';
  const text = String(value).trim();
  if (text.length > max) throw new Error('text_too_long');
  return text;
}
function cleanNumber(value, nullable = false) {
  if (value === null || value === undefined || value === '') return nullable ? null : 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1000000) throw new Error('invalid_number');
  return Number(n.toFixed(2));
}

async function login(req, res) {
  const body = bodyOf(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password || username.length > 80 || password.length > 200) return res.status(400).json({ ok:false,error:'invalid_login' });
  const valid = await verifyCredentials(username, password);
  if (!valid) {
    await new Promise(resolve => setTimeout(resolve, 350));
    return res.status(401).json({ ok:false,error:'invalid_login' });
  }
  const session = await createSession();
  setSessionCookie(res, session.token);
  await audit('login','admin',username,{});
  return res.status(200).json({ ok:true,expiresAt:session.expiresAt });
}

async function logout(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await deleteSession(token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  await audit('logout','admin','admin',{});
  return res.status(200).json({ ok:true });
}

async function getProducts(res) {
  const { supabaseUrl } = config();
  const r = await fetch(`${supabaseUrl}/rest/v1/products?select=*&order=sort_order.asc,created_at.asc`,{headers:dbHeaders()});
  if (!r.ok) throw new Error(`products_read_${r.status}`);
  return res.status(200).json({ok:true,products:await r.json()});
}

async function patchProduct(req,res) {
  const body = bodyOf(req);
  const id = String(body.id||'').trim();
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return res.status(400).json({ok:false,error:'invalid_product_id'});
  const { supabaseUrl } = config();
  const er = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,{headers:dbHeaders()});
  if(!er.ok) throw new Error(`product_read_${er.status}`);
  const existing=(await er.json())[0];
  if(!existing) return res.status(404).json({ok:false,error:'product_not_found'});
  const update={};
  if('name' in body){const name=cleanText(body.name,120,false);if(name.length<2)return res.status(400).json({ok:false,error:'invalid_name'});update.name=name;}
  if('selling_price' in body) update.selling_price=cleanNumber(body.selling_price);
  if('old_price' in body) update.old_price=cleanNumber(body.old_price,true);
  if('active' in body) update.active=Boolean(body.active);
  if('image_url' in body) update.image_url=cleanText(body.image_url,2000);
  if('description' in body) update.description=cleanText(body.description,1200);
  if('badge' in body) update.badge=cleanText(body.badge,100);
  if('kind' in body) update.kind=cleanText(body.kind,200);
  if('supplier_url' in body) update.supplier_url=cleanText(body.supplier_url,2000);
  if('supplier_product_id' in body) update.supplier_product_id=cleanText(body.supplier_product_id,100);
  if('supplier_sku_id' in body) update.supplier_sku_id=cleanText(body.supplier_sku_id,100);
  if('variant_label' in body) update.variant_label=cleanText(body.variant_label,200);
  if('sort_order' in body){const n=Number(body.sort_order);if(!Number.isInteger(n)||n<-10000||n>10000)return res.status(400).json({ok:false,error:'invalid_sort_order'});update.sort_order=n;}
  if('categories' in body){if(!Array.isArray(body.categories)||body.categories.length>10)return res.status(400).json({ok:false,error:'invalid_categories'});update.categories=body.categories.map(v=>String(v).trim()).filter(Boolean).slice(0,10);}
  if('specs' in body){if(!Array.isArray(body.specs)||body.specs.length>30)return res.status(400).json({ok:false,error:'invalid_specs'});update.specs=body.specs.map(v=>String(v).trim()).filter(Boolean).slice(0,30);}
  const supplierChanged=['supplier_url','supplier_product_id','supplier_sku_id','variant_label'].some(k=>k in update&&update[k]!==existing[k]);
  if(supplierChanged){update.fulfillment_ready=false;update.last_sync_at=null;}
  update.updated_at=new Date().toISOString();
  const r=await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:dbHeaders({'Content-Type':'application/json',Prefer:'return=representation'}),body:JSON.stringify(update)});
  if(!r.ok) throw new Error(`product_update_${r.status}_${(await r.text()).slice(0,200)}`);
  const row=(await r.json())[0]||null;
  await audit('product_update','product',id,{fields:Object.keys(update)});
  return res.status(200).json({ok:true,product:row});
}

async function getOrders(req,res){
  const { supabaseUrl }=config();
  const raw=Number(req.query?.limit||100);const limit=Number.isFinite(raw)?Math.max(1,Math.min(200,Math.floor(raw))):100;
  const r=await fetch(`${supabaseUrl}/rest/v1/orders?select=*&order=created_at.desc&limit=${limit}`,{headers:dbHeaders()});
  if(!r.ok) throw new Error(`orders_read_${r.status}`);
  return res.status(200).json({ok:true,orders:await r.json()});
}

async function patchOrder(req,res){
  const body=bodyOf(req);const orderId=String(body.order_id||'').trim();
  if(!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)) return res.status(400).json({ok:false,error:'invalid_order_id'});
  const update={};
  if('status' in body){const v=String(body.status||'');if(!ORDER_STATUSES.has(v))return res.status(400).json({ok:false,error:'invalid_status'});update.status=v;}
  if('fulfillment_status' in body){const v=String(body.fulfillment_status||'');if(!FULFILLMENT_STATUSES.has(v))return res.status(400).json({ok:false,error:'invalid_fulfillment_status'});update.fulfillment_status=v;}
  if('supplier_order_id' in body) update.supplier_order_id=cleanText(body.supplier_order_id,120);
  if('tracking_number' in body) update.tracking_number=cleanText(body.tracking_number,160);
  if('last_error' in body) update.last_error=cleanText(body.last_error,1200);
  if(!Object.keys(update).length) return res.status(400).json({ok:false,error:'no_changes'});
  update.updated_at=new Date().toISOString();
  const { supabaseUrl }=config();
  const r=await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}`,{method:'PATCH',headers:dbHeaders({'Content-Type':'application/json',Prefer:'return=representation'}),body:JSON.stringify(update)});
  if(!r.ok) throw new Error(`order_update_${r.status}_${(await r.text()).slice(0,200)}`);
  const row=(await r.json())[0];if(!row)return res.status(404).json({ok:false,error:'order_not_found'});
  await audit('order_update','order',orderId,{fields:Object.keys(update)});
  return res.status(200).json({ok:true,order:row});
}

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  const action=String(req.query?.action||'');
  try{
    if(action==='login'&&req.method==='POST') return await login(req,res);
    if(action==='logout'&&req.method==='POST') return await logout(req,res);
    if(!await requireAdmin(req,res)) return;
    if(action==='products'&&req.method==='GET') return await getProducts(res);
    if(action==='product'&&req.method==='PATCH') return await patchProduct(req,res);
    if(action==='orders'&&req.method==='GET') return await getOrders(req,res);
    if(action==='order'&&req.method==='PATCH') return await patchOrder(req,res);
    return res.status(404).json({ok:false,error:'unknown_action'});
  }catch(error){console.error('admin api error',error);return res.status(500).json({ok:false,error:'admin_api_failed'});}
};
