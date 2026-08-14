module.exports = async function handler(req, res) {
  try {
    const protocol = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = req.headers.host;
    const pageUrl = `${protocol}://${host}/index.html`;
    const response = await fetch(pageUrl, { headers: { 'cache-control': 'no-cache' } });
    let html = await response.text();

    const oldCheckout = "function checkoutNotice(){showToast('בשלב הבא נחבר תשלום ומשלוח אוטומטי')}";
    const newCheckout = `async function checkoutNotice(){
  const entries=Object.entries(cart);
  if(!entries.length){showToast('הסל עדיין ריק');return;}
  const btn=document.querySelector('.checkout');
  const oldText=btn?btn.textContent:'';
  if(btn){btn.disabled=true;btn.textContent='יוצר הזמנה...';}
  try{
    const items=entries.map(([id,qty])=>{const p=products.find(x=>x.id===id);return p?{id:p.id,name:p.name,qty,price:p.price,variant:p.variant||null,url:p.url||null}:null}).filter(Boolean);
    const r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items})});
    const data=await r.json();
    if(!r.ok||!data.ok)throw new Error(data.error||'order_failed');
    localStorage.setItem('alufLastOrder',JSON.stringify(data));
    showToast('הזמנה נוצרה: '+data.orderId);
    if(btn)btn.textContent='הזמנה '+data.orderId;
  }catch(e){
    showToast('לא הצלחנו ליצור הזמנה. נסה שוב');
    if(btn)btn.textContent=oldText||'המשך להזמנה';
  }finally{
    if(btn)btn.disabled=false;
  }
}`;

    if (html.includes(oldCheckout)) html = html.replace(oldCheckout, newCheckout);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).send('Site temporarily unavailable');
  }
};
