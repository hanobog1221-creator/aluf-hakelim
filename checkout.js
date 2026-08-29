(() => {
  const style = document.createElement('style');
  style.textContent = `
  .ahCheckout{display:none;position:fixed;inset:0;background:radial-gradient(circle at 85% 10%,#263544cc,transparent 34%),#05080deF;z-index:170;padding:20px;place-items:center;backdrop-filter:blur(8px)}.ahCheckout.open{display:grid}
  .ahCheckoutCard{width:min(1040px,100%);max-height:94vh;overflow:auto;background:#fff;border:1px solid #ffffff33;border-radius:24px;box-shadow:0 32px 100px #0009}.ahCheckoutHead{display:flex;align-items:center;justify-content:space-between;padding:15px 20px;border-bottom:1px solid #e5e7eb;position:sticky;top:0;background:#0b1118;color:#fff;z-index:5}.ahCheckoutBrand{display:flex;align-items:center;gap:11px}.ahCheckoutMark{width:42px;height:42px;display:grid;place-items:center;border-radius:13px;background:#ffc928;color:#0b1118;font-size:23px;font-weight:950}.ahCheckoutBrand strong{display:block;font-size:19px}.ahCheckoutBrand small{display:block;color:#b8c3ce;margin-top:2px}.ahCheckoutClose{border:1px solid #3b4855;background:#17212d;color:#fff;width:42px;height:42px;border-radius:12px;font-size:18px}.ahCheckoutClose:hover{background:#243140}.ahCheckoutBody{padding:0}
  .ahCheckoutNote{background:#fff8d8;border:1px solid #f0d36e;border-radius:13px;padding:12px 14px;margin:0 0 15px;font-size:13px;line-height:1.55}.ahCheckoutLayout{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(310px,.8fr);direction:rtl}.ahCheckoutFields{padding:24px}.ahCheckoutOrder{background:#f4f6f8;border-right:1px solid #e0e5e9;padding:24px;position:relative}.ahCheckoutOrder h3{margin:0 0 5px;font-size:20px}.ahCheckoutOrderIntro{color:#66717d;font-size:13px;margin:0 0 16px}.ahCheckoutGrid{display:grid;grid-template-columns:1fr 1fr;gap:13px}.ahField{display:flex;flex-direction:column;gap:6px}.ahField.full{grid-column:1/-1}.ahField label{font-size:13px;font-weight:900;color:#28323d}.ahField input,.ahField textarea{width:100%;border:1px solid #cbd2d9;border-radius:11px;padding:12px 13px;font:inherit;background:#fff;transition:.18s}.ahField input:focus,.ahField textarea:focus{border-color:#d5a400;box-shadow:0 0 0 3px #ffc92830;outline:0}.ahField textarea{min-height:78px;resize:vertical}.ahTerms{display:flex;align-items:flex-start;gap:9px;margin:14px 0;padding:11px 12px;border:1px solid #e0e4e8;border-radius:11px;background:#fafbfc;font-size:13px;line-height:1.55}.ahTerms input{width:18px;height:18px;flex:0 0 auto;accent-color:#111923}.ahTerms a{font-weight:900;color:#111923;text-decoration:underline;text-underline-offset:3px}.ahOrderItems{display:grid;gap:10px;margin-bottom:16px}.ahOrderItem{display:grid;grid-template-columns:58px minmax(0,1fr) auto;gap:10px;align-items:center;background:#fff;border:1px solid #e0e5e9;border-radius:13px;padding:9px}.ahOrderItem img{width:58px;height:58px;object-fit:contain;border-radius:9px;background:#fff}.ahOrderItem b{display:block;font-size:13px;line-height:1.35}.ahOrderItem small{display:block;color:#6c7680;margin-top:4px}.ahOrderItemPrice{font-size:13px;font-weight:950;white-space:nowrap}.ahCheckoutSummary{margin:0;border-top:1px solid #d9dfe4;padding-top:12px}.ahCheckoutSummaryRow{display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:14px}.ahCheckoutSummaryRow.total{font-size:22px;font-weight:950;border-top:1px solid #cfd6dc;margin-top:8px;padding-top:13px}.ahDiscount{color:#197342;font-weight:900}.ahMuted{color:#68717c}.ahSecureStrip{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:15px 0}.ahSecureStrip span{background:#fff;border:1px solid #dfe4e8;border-radius:9px;padding:8px 6px;text-align:center;color:#4f5c68;font-size:11px;font-weight:850}.ahCheckoutSubmit{width:100%;min-height:52px;border:0;border-radius:12px;background:linear-gradient(180deg,#ffd64b,#ffc21c);color:#15100a;font-weight:950;font-size:15px;cursor:pointer;box-shadow:0 8px 20px #d79e0029}.ahCheckoutSubmit:hover{filter:brightness(.98);transform:translateY(-1px)}.ahCheckoutSubmit:disabled{opacity:.55;cursor:not-allowed;transform:none}.ahCheckoutSecondary{background:#eef1f4;box-shadow:none;color:#28323d}.ahCheckoutError{display:none;color:#a92318;background:#fff0ee;border:1px solid #ffc9c2;border-radius:10px;padding:10px 12px;margin:12px 0;font-size:13px}.ahCheckoutError.show{display:block}
  .ahCheckoutSuccess{padding:28px}.ahPaymentHero{text-align:center;padding:5px 10px 20px}.ahPaymentIcon{width:64px;height:64px;border-radius:20px;background:#fff5c7;color:#111923;display:grid;place-items:center;margin:0 auto 12px;font-size:29px}.ahPaymentHero h2{font-size:28px;margin:0 0 7px}.ahPaymentHero p{margin:0;color:#65717c}.ahPaymentGrid{display:grid;grid-template-columns:1fr 1fr;gap:16px;text-align:right}.ahPaymentBox{border:1px solid #dfe4e8;border-radius:16px;padding:17px;background:#fff}.ahPaymentBox.summary{background:#f5f7f9}.ahPaymentBox h3{margin:0 0 13px;font-size:16px}.ahOrderId{display:inline-flex;align-items:center;gap:7px;background:#111923;color:#fff;padding:9px 13px;border-radius:10px;font-weight:900;margin:0 0 13px;direction:ltr;letter-spacing:.3px}.ahPaymentRows{display:grid;gap:0}.ahPaymentRow{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #e1e5e9}.ahPaymentRow:last-child{border-bottom:0}.ahPaymentRow.total{font-size:22px;font-weight:950;padding-top:13px}.ahPayPalWrap{margin:17px auto 0;max-width:520px}.ahPayPalBadge{display:inline-flex;align-items:center;gap:6px;background:#e8f1ff;color:#173b69;border-radius:999px;padding:7px 11px;font-size:12px;font-weight:900}.ahPayPalStatus{color:#68717c;line-height:1.55;margin:11px 0}.ahPaymentFoot{max-width:520px;margin:0 auto;text-align:center}.ahPaymentFine{font-size:12px;color:#737e88;margin:10px 0 0}
  .drawerHead{background:#0b1118;color:#fff}.drawerHead .close{background:#202b37;color:#fff}.drawerFoot{background:#f7f9fa}.cartLine{border:1px solid #e1e5e9!important;border-radius:13px;padding:10px!important;margin-bottom:9px}.checkout{min-height:52px;border-radius:12px!important;background:linear-gradient(180deg,#ffd64b,#ffc21c)!important;box-shadow:0 8px 20px #d79e0029}
  @media(max-width:780px){.ahCheckout{padding:0;align-items:stretch}.ahCheckoutCard{max-height:100vh;height:100%;border-radius:0}.ahCheckoutLayout{grid-template-columns:1fr}.ahCheckoutOrder{border-right:0;border-top:1px solid #e0e5e9}.ahPaymentGrid{grid-template-columns:1fr}.ahCheckoutHead{padding:12px 14px}.ahCheckoutSuccess{padding:20px 15px}}
  @media(max-width:520px){.ahCheckoutGrid{grid-template-columns:1fr}.ahField.full{grid-column:auto}.ahCheckoutFields,.ahCheckoutOrder{padding:17px}.ahCheckoutOrder{order:-1}.ahSecureStrip{grid-template-columns:1fr}.ahPaymentHero h2{font-size:24px}.ahOrderItem{grid-template-columns:52px minmax(0,1fr) auto}.ahOrderItem img{width:52px;height:52px}}
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'ahCheckout';
  overlay.innerHTML = `<div class="ahCheckoutCard" role="dialog" aria-modal="true" aria-labelledby="ahCheckoutTitle"><div class="ahCheckoutHead"><div class="ahCheckoutBrand"><span class="ahCheckoutMark" aria-hidden="true">⚒</span><div><strong id="ahCheckoutTitle">אלוף הכלים</strong><small>קופה מאובטחת</small></div></div><button class="ahCheckoutClose" type="button" aria-label="סגירת הקופה">✕</button></div><div class="ahCheckoutBody" id="ahCheckoutBody"></div></div>`;
  document.body.appendChild(overlay);
  const bodyBox = overlay.querySelector('#ahCheckoutBody');
  let currentAttemptId = null;

  const money = (v) => '₪' + Number(v || 0).toFixed(2);
  const deliveryMethodLabel = (value) => ({home_delivery:'משלוח עד הבית',pickup_point:'נקודת איסוף / לוקר',mixed:'מסירה משולבת',unknown:'ייקבע לפי אפשרויות השילוח'}[String(value||'unknown')] || 'ייקבע לפי אפשרויות השילוח');
  const cartEntries = () => { try { return Object.entries(JSON.parse(localStorage.getItem('alufCart') || '{}')).filter(([,q]) => Number(q) > 0); } catch { return []; } };
  const productList = () => { try { return Array.isArray(products) ? products : []; } catch { return []; } };
  const cartTotal = (entries) => entries.reduce((sum,[id,qty]) => { const p=productList().find(x=>String(x.id)===String(id)); return sum+(p?Number(p.price||0)*Number(qty):0); },0);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const safeImage = (value) => { try { const url=new URL(String(value||''),location.origin);return ['http:','https:'].includes(url.protocol)?esc(url.href):''; } catch { return ''; } };
  function cartItemRows(entries) {
    return entries.map(([id,quantity])=>{const product=productList().find((item)=>String(item.id)===String(id));if(!product)return '';const image=safeImage(product.img||product.image);const qty=Math.max(1,Number(quantity||1));return `<div class="ahOrderItem">${image?`<img src="${image}" alt="">`:'<span class="ahCheckoutMark" aria-hidden="true">⚒</span>'}<div><b>${esc(product.name)}</b><small>כמות: ${qty}</small></div><span class="ahOrderItemPrice">${money(Number(product.price||0)*qty)}</span></div>`}).join('');
  }
  function resultItemRows(result) {
    const items=Array.isArray(result?.items)?result.items:[];
    if(!items.length)return cartItemRows(cartEntries());
    return items.map((item)=>{const product=productList().find((row)=>String(row.id)===String(item.id));const image=safeImage(product?.img||product?.image);const qty=Math.max(1,Number(item.qty||1));return `<div class="ahOrderItem">${image?`<img src="${image}" alt="">`:'<span class="ahCheckoutMark" aria-hidden="true">⚒</span>'}<div><b>${esc(item.name||product?.name||'מוצר')}</b><small>כמות: ${qty}</small></div><span class="ahOrderItemPrice">${money(Number(item.price||product?.price||0)*qty)}</span></div>`}).join('');
  }
  function enhanceCheckoutForm(entries) {
    const form=document.getElementById('ahCheckoutForm');if(!form)return;
    form.className='ahCheckoutLayout';
    const fields=document.createElement('section');fields.className='ahCheckoutFields';
    const order=document.createElement('aside');order.className='ahCheckoutOrder';order.setAttribute('aria-label','סיכום הזמנה');
    const note=bodyBox.querySelector('.ahCheckoutNote');if(note)fields.appendChild(note);
    const grid=form.querySelector('.ahCheckoutGrid'),terms=form.querySelector('.ahTerms:not(#ahImportConsentWrap)'),importConsent=form.querySelector('#ahImportConsentWrap'),error=form.querySelector('#ahCheckoutError'),submit=form.querySelector('#ahCheckoutSubmit'),summary=form.querySelector('.ahCheckoutSummary');
    [grid,terms,importConsent,error,submit].forEach((node)=>{if(node)fields.appendChild(node)});
    order.innerHTML=`<h3>ההזמנה שלך</h3><p class="ahCheckoutOrderIntro">המחיר והמשלוח יאומתו לפני פתיחת התשלום.</p><div class="ahOrderItems">${cartItemRows(entries)}</div><div class="ahSecureStrip"><span>🔒 תשלום מאובטח</span><span>✓ מחיר מאומת</span><span>🚚 משלוח מחושב</span></div>`;
    if(summary)order.appendChild(summary);
    form.append(fields,order);
  }
  const attemptId = () => 'req_' + (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`);
  const open = () => { try{if(typeof closeCart==='function') closeCart();}catch{} document.body.classList.add('locked');overlay.classList.add('open');overlay.querySelector('.ahCheckoutCard').scrollTop=0;setTimeout(()=>overlay.querySelector('.ahCheckoutClose')?.focus(),0); };
  const close = () => { overlay.classList.remove('open');document.body.classList.remove('locked'); };
  const showError = (msg) => { const el=document.getElementById('ahCheckoutError'); if(el){el.textContent=msg;el.classList.add('show');} };

  async function jsonRequest(url, options={}) {
    const r = await fetch(url, options);
    const d = await r.json().catch(()=>({}));
    if (!r.ok || d.ok !== true) { const e=new Error(String(d.error||'request_failed')); e.code=d.error; e.data=d; throw e; }
    return d;
  }

  function paymentMessage(error) {
    const c=String(error?.code||error?.message||'');
    if(c==='sales_disabled') return 'הקנייה באתר אינה זמינה כרגע.';
    if(c==='paypal_live_required') return 'אפשרות התשלום אינה זמינה כרגע.';
    if(c==='supplier_live_not_enabled'||c==='supplier_autopay_required') return 'לא ניתן להשלים את ההזמנה כרגע.';
    if(c.includes('not_ready')||c.includes('not_payable')||c.includes('stale')) return 'ההזמנה השתנתה או שהצעת המשלוח התיישנה. סגור ובדוק מחדש.';
    if(c==='paypal_capture_not_completed') return 'התשלום לא הושלם.';
    if(c.includes('mismatch')) return 'פרטי התשלום לא תאמו להזמנה ולכן היא לא סומנה כמשולמת.';
    if(c==='paypal_not_configured') return 'אפשרות התשלום אינה זמינה כרגע.';
    if(c==='payment_provider_not_configured'||c==='whop_not_configured') return 'מערכת התשלום עדיין לא הוגדרה במלואה.';
    if(c.includes('whop_')) return 'לא הצלחנו לפתוח את התשלום המאובטח. לא בוצע חיוב.';
    return 'לא הצלחנו להשלים את התשלום. לא סומן תשלום.';
  }

  function safePayPalApproval(url, environment) {
    try {
      const u=new URL(String(url||''));
      const expected=environment==='live'?'www.paypal.com':'www.sandbox.paypal.com';
      return u.protocol==='https:'&&u.hostname.toLowerCase()===expected;
    } catch { return false; }
  }

  function safeWhopApproval(url) {
    try {
      const u=new URL(String(url||'')),host=u.hostname.toLowerCase();
      return u.protocol==='https:'&&(host==='whop.com'||host.endsWith('.whop.com'));
    } catch { return false; }
  }

  async function startPaymentRedirect(order) {
    const status=document.getElementById('ahPayPalStatus');
    const btn=document.getElementById('ahPayPalRedirect');
    if(btn) btn.disabled=true;
    if(status) status.textContent='יוצר תשלום מאובטח…';
    try {
      const out=await jsonRequest('/api/payment?action=create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:order.orderId})});
      const provider=String(out.provider||'paypal');
      if(provider==='paypal'&&!safePayPalApproval(out.approveUrl,out.environment)) throw new Error('paypal_approval_url_invalid');
      if(provider==='whop'&&!safeWhopApproval(out.approveUrl)) throw new Error('whop_approval_url_invalid');
      if(!['paypal','whop'].includes(provider)) throw new Error('payment_provider_invalid');
      try{sessionStorage.setItem('alufPendingPaymentOrder',String(order.orderId||''));}catch{}
      if(status) status.textContent='מעביר לתשלום המאובטח…';
      location.assign(out.approveUrl);
    } catch(e) {
      if(status) status.textContent=paymentMessage(e);
      if(btn) btn.disabled=false;
    }
  }

  function renderPaymentStep(result) {
    bodyBox.innerHTML=`<div class="ahCheckoutSuccess"><div class="ahPaymentHero"><div class="ahPaymentIcon" aria-hidden="true">🔒</div><span class="ahPayPalBadge">הזמנה נשמרה · עדיין לא בוצע חיוב</span><h2>הכול מוכן לתשלום</h2><p>בדוק את הסיכום ולחץ על הכפתור הצהוב למעבר לעמוד התשלום המאובטח.</p></div><div class="ahPaymentGrid"><section class="ahPaymentBox"><h3>פרטי ההזמנה</h3><div class="ahOrderId">${esc(result.orderId||'')}</div><div class="ahOrderItems">${resultItemRows(result)}</div></section><section class="ahPaymentBox summary"><h3>סיכום לתשלום</h3><div class="ahPaymentRows"><div class="ahPaymentRow"><span>מוצרים</span><b>${money(result.discountedProductsSubtotal??result.productsSubtotal)}</b></div><div class="ahPaymentRow"><span>משלוח · ${esc(deliveryMethodLabel(result.deliveryMethod))}</span><b>${Number(result.shippingCost||0)<=0?'חינם':money(result.shippingCost)}</b></div><div class="ahPaymentRow total"><span>סה״כ</span><b>${money(result.total)}</b></div></div><div class="ahSecureStrip"><span>🔒 חיבור מאובטח</span><span>✓ סכום סופי</span><span>🛡️ ללא חיוב כפול</span></div></section></div><div class="ahPaymentFoot"><p id="ahPayPalStatus" class="ahPayPalStatus" role="status">לחיצה על הכפתור תעביר אותך לתשלום. לא חויבת עדיין.</p><div class="ahPayPalWrap"><button class="ahCheckoutSubmit" id="ahPayPalRedirect" type="button">מעבר לתשלום מאובטח</button></div><button class="ahCheckoutSubmit ahCheckoutSecondary" id="ahCloseNoPay" type="button" style="margin-top:10px">חזרה לחנות בלי לשלם</button><p class="ahPaymentFine">ההזמנה תטופל רק לאחר קבלת אישור תשלום.</p></div></div>`;
    overlay.querySelector('.ahCheckoutCard').scrollTop=0;
    document.getElementById('ahCloseNoPay')?.addEventListener('click',close);
    document.getElementById('ahPayPalRedirect')?.addEventListener('click',()=>startPaymentRedirect(result));
  }

  async function finishPayPalReturn() {
    const params=new URLSearchParams(location.search);
    const state=params.get('paypal');
    if(state!=='approved'&&state!=='cancelled') return;
    const orderId=String(params.get('storeOrderId')||'').trim().toUpperCase();
    const paypalOrderId=String(params.get('token')||'').trim();
    history.replaceState({},'',location.pathname);
    open();
    if(state==='cancelled') {
      bodyBox.innerHTML=`<div class="ahCheckoutSuccess"><h2>התשלום בוטל</h2><p>לא בוצע חיוב.</p>${/^AH-[A-Z0-9-]{5,60}$/.test(orderId)?`<div class="ahOrderId">${orderId}</div>`:''}<button class="ahCheckoutSubmit" id="ahDone">חזרה לחנות</button></div>`;
      document.getElementById('ahDone')?.addEventListener('click',close);
      return;
    }
    if(!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)||!paypalOrderId) {
      bodyBox.innerHTML='<div class="ahCheckoutSuccess"><h2>לא הצלחנו לאשר את התשלום</h2><p class="ahMuted">ההזמנה לא סומנה כשולמה. אם ירד חיוב, פנו אלינו ונבדוק זאת מיד.</p><button class="ahCheckoutSubmit" id="ahDone">סגור</button></div>';
      document.getElementById('ahDone')?.addEventListener('click',close);
      return;
    }
    bodyBox.innerHTML=`<div class="ahCheckoutSuccess"><h2>מאמת תשלום…</h2><div class="ahOrderId">${orderId}</div><p id="ahReturnStatus" class="ahPayPalStatus">בודקים את אישור התשלום המאובטח.</p></div>`;
    try {
      const out=await jsonRequest('/api/payment?action=capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId,paypalOrderId})});
      try{localStorage.removeItem('alufCart');sessionStorage.removeItem('alufPendingPayPalOrder')}catch{}
      if(typeof renderCart==='function') renderCart();
      bodyBox.innerHTML=`<div class="ahCheckoutSuccess"><div style="font-size:46px">✓</div><h2>התשלום הושלם</h2><p>ההזמנה התקבלה ותועבר לטיפול.</p><div class="ahOrderId">${String(out.orderId||orderId)}</div><button class="ahCheckoutSubmit" id="ahDone">סגור</button></div>`;
      currentAttemptId=null;
      document.getElementById('ahDone')?.addEventListener('click',close);
    } catch(e) {
      bodyBox.innerHTML=`<div class="ahCheckoutSuccess"><h2>התשלום לא הושלם</h2><p class="ahCheckoutError show">${paymentMessage(e)}</p><div class="ahOrderId">${orderId}</div><p class="ahMuted">פרטי ההזמנה נשמרו. לא בוצע חיוב נוסף.</p><button class="ahCheckoutSubmit" id="ahDone">סגור</button></div>`;
      document.getElementById('ahDone')?.addEventListener('click',close);
    }
  }

  async function finishWhopReturn() {
    const params=new URLSearchParams(location.search);
    if(params.get('whop')!=='return') return;
    const orderId=String(params.get('storeOrderId')||'').trim().toUpperCase();
    history.replaceState({},'',location.pathname);
    open();
    if(!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)) {
      bodyBox.innerHTML='<div class="ahCheckoutSuccess"><h2>לא ניתן לזהות את ההזמנה</h2><p class="ahMuted">לא סומן תשלום.</p><button class="ahCheckoutSubmit" id="ahDone">סגור</button></div>';
      document.getElementById('ahDone')?.addEventListener('click',close);return;
    }
    bodyBox.innerHTML=`<div class="ahCheckoutSuccess"><h2>מאמת תשלום…</h2><div class="ahOrderId">${orderId}</div><p class="ahPayPalStatus">ממתין לאישור התשלום.</p></div>`;
    for(let attempt=0;attempt<8;attempt++) {
      try {
        const out=await jsonRequest(`/api/payment?action=status&orderId=${encodeURIComponent(orderId)}`);
        if(out.paymentStatus==='paid') {
          try{localStorage.removeItem('alufCart');sessionStorage.removeItem('alufPendingPaymentOrder')}catch{}
          if(typeof renderCart==='function') renderCart();
          bodyBox.innerHTML=`<div class="ahCheckoutSuccess"><div style="font-size:46px">✓</div><h2>התשלום הושלם</h2><p>התשלום אושר וההזמנה הועברה לטיפול.</p><div class="ahOrderId">${orderId}</div><button class="ahCheckoutSubmit" id="ahDone">סגור</button></div>`;
          currentAttemptId=null;document.getElementById('ahDone')?.addEventListener('click',close);return;
        }
      } catch(e) { if(attempt===7) break; }
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
    bodyBox.innerHTML=`<div class="ahCheckoutSuccess"><h2>האישור עדיין בעיבוד</h2><div class="ahOrderId">${orderId}</div><p class="ahMuted">ההזמנה נשמרה. אפשר לבדוק את מצבה בעמוד מעקב ההזמנות בעוד רגע.</p><button class="ahCheckoutSubmit" id="ahDone">סגור</button></div>`;
    document.getElementById('ahDone')?.addEventListener('click',close);
  }

  function customerFrom(form) {
    const d=new FormData(form); if(String(d.get('website')||'').trim()) return null;
    return {fullName:String(d.get('fullName')||'').trim(),phone:String(d.get('phone')||'').trim(),email:String(d.get('email')||'').trim(),city:String(d.get('city')||'').trim(),street:String(d.get('street')||'').trim(),houseNumber:String(d.get('houseNumber')||'').trim(),apartment:String(d.get('apartment')||'').trim(),postalCode:String(d.get('postalCode')||'').trim(),notes:String(d.get('notes')||'').trim(),countryCode:'IL'};
  }
  function validateCustomer(c){if(!c)return 'שגיאה בטופס.';if(c.fullName.length<2||c.city.length<2||c.street.length<2||!c.houseNumber)return 'יש למלא שם מלא וכתובת מלאה.';const digits=c.phone.replace(/\D/g,'');if(digits.length<8||digits.length>15)return 'מספר הטלפון לא תקין.';if(c.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))return 'האימייל לא תקין.';return null;}

  async function postOrder(entries, customer, quoteOnly) {
    if(!currentAttemptId) currentAttemptId=attemptId();
    const r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:entries.map(([id,qty])=>({id,qty:Number(qty)})),customer,couponCode:String(document.getElementById('ahCoupon')?.value||'').trim().toUpperCase(),clientRequestId:currentAttemptId,termsAccepted:Boolean(document.getElementById('ahTerms')?.checked),importChargesAccepted:Boolean(document.getElementById('ahImportConsent')?.checked),quoteOnly})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok){
      if(d.error==='sales_disabled') throw new Error('הקנייה באתר אינה זמינה כרגע.');
      if(d.error==='product_unavailable') throw new Error('אחד המוצרים אינו זמין כרגע.');
      if(d.error==='product_not_purchase_ready') throw new Error('אחד המוצרים עדיין אינו מוכן להזמנה.');
      if(d.error==='quantity_limit') throw new Error(`אפשר להזמין עד ${Number(d.maxQty||1)} יחידות.`);
      if(d.error==='terms_required') throw new Error('יש לאשר את תנאי השימוש.');
      if(d.error==='import_charges_consent_required') throw new Error('יש לאשר שהבנת את אומדן מסי היבוא האפשריים.');
      throw new Error(String(d.error||'לא הצלחנו לבדוק את ההזמנה.'));
    }
    return d;
  }

  function applyQuote(q) {
    document.getElementById('ahProductsSubtotal').textContent=money(q.productsSubtotal||0);
    const discount=document.getElementById('ahDiscountRow');
    if(Number(q.discountAmount||0)>0){discount.style.display='flex';document.getElementById('ahDiscount').textContent='-'+money(q.discountAmount);}else discount.style.display='none';
    document.getElementById('ahShippingCost').textContent=q.shippingStatus==='quoted'?(Number(q.shippingCost||0)<=0?'חינם':money(q.shippingCost)):'בבדיקה';
    document.getElementById('ahDeliveryMethod').textContent=deliveryMethodLabel(q.deliveryMethod);
    document.getElementById('ahDeliveryMethodRow').style.display=q.shippingStatus==='quoted'?'flex':'none';
    const estimatedTax=Number(q.estimatedImportTax||0);document.getElementById('ahImportTaxRow').style.display=estimatedTax>0?'flex':'none';document.getElementById('ahImportTax').textContent=money(estimatedTax);document.getElementById('ahImportConsentWrap').style.display=estimatedTax>0?'flex':'none';
    document.getElementById('ahGrandTotal').textContent=money(q.estimatedTotalWithImportTax??q.total??0);
    document.getElementById('ahShipmentPlanRow').style.display=Number(q.importPlan?.shipmentCount||1)>1?'flex':'none';document.getElementById('ahShipmentPlan').textContent=`${Number(q.importPlan?.shipmentCount||1)} חבילות`;
  }

  async function submitCheckout(ev) {
    ev.preventDefault();const form=ev.currentTarget,btn=document.getElementById('ahCheckoutSubmit'),c=customerFrom(form),err=validateCustomer(c);if(err){showError(err);return;}if(!document.getElementById('ahTerms')?.checked){showError('יש לאשר את תנאי השימוש.');return;}
    if(btn.dataset.stage!=='quote'&&document.getElementById('ahImportConsentWrap').style.display!=='none'&&!document.getElementById('ahImportConsent')?.checked){showError('יש לאשר שהבנת את אומדן מסי היבוא האפשריים.');return;}
    const entries=cartEntries();if(!entries.length){showError('הסל ריק.');return;}btn.disabled=true;document.getElementById('ahCheckoutError')?.classList.remove('show');
    try{
      if(btn.dataset.stage==='quote'){
        btn.textContent='בודק מחיר ומשלוח…';const q=await postOrder(entries,c,true);applyQuote(q);
        if(q.salesEnabled===false){document.getElementById('ahShippingStatus').textContent='הקנייה באתר אינה זמינה כרגע.';btn.dataset.stage='closed';btn.textContent='לא זמין כרגע';btn.disabled=true;return;}
        if(q.shippingStatus!=='quoted') throw new Error('אין כרגע אפשרות משלוח לכתובת הזאת.');
        document.getElementById('ahShippingStatus').textContent=`הפרטים עודכנו. אופן המסירה: ${deliveryMethodLabel(q.deliveryMethod)}.`;btn.dataset.stage='finalize';btn.textContent='אישור והמשך לתשלום';btn.disabled=false;return;
      }
      if(btn.dataset.stage==='closed') throw new Error('הקנייה באתר אינה זמינה כרגע.');
      btn.textContent='שומר הזמנה…';const result=await postOrder(entries,c,false);
      renderPaymentStep(result);
    }catch(e){showError(e.message||'אירעה שגיאה.');btn.disabled=false;if(btn.dataset.stage==='quote')btn.textContent='בדיקת פרטים והמשך';else if(btn.dataset.stage==='closed'){btn.textContent='לא זמין כרגע';btn.disabled=true;}else btn.textContent='אישור והמשך לתשלום';}
  }

  function renderForm() {
    const entries=cartEntries();currentAttemptId=attemptId();
    if(!entries.length){bodyBox.innerHTML='<div class="ahCheckoutSuccess"><div class="ahPaymentIcon">🛒</div><h2>הסל עדיין ריק</h2><p class="ahMuted">אפשר לחזור לחנות ולהוסיף מוצר.</p><button class="ahCheckoutSubmit" id="ahDone">חזרה למוצרים</button></div>';open();document.getElementById('ahDone')?.addEventListener('click',close);return;}
    bodyBox.innerHTML=`<div class="ahCheckoutNote"><b>תשלום מאובטח.</b> לפני התשלום נוודא שהמחיר, המלאי והמשלוח עדכניים.</div><form id="ahCheckoutForm"><div class="ahCheckoutGrid"><div class="ahField full"><label for="ahFullName">שם מלא *</label><input id="ahFullName" name="fullName" autocomplete="name" maxlength="80" required></div><div class="ahField"><label for="ahPhone">טלפון *</label><input id="ahPhone" name="phone" dir="ltr" inputmode="tel" autocomplete="tel" maxlength="20" required></div><div class="ahField"><label for="ahEmail">אימייל</label><input id="ahEmail" name="email" type="email" autocomplete="email" maxlength="120"></div><div class="ahField"><label for="ahCity">עיר *</label><input id="ahCity" name="city" autocomplete="address-level2" maxlength="80" required></div><div class="ahField"><label for="ahStreet">רחוב *</label><input id="ahStreet" name="street" autocomplete="address-line1" maxlength="100" required></div><div class="ahField"><label for="ahHouseNumber">מספר בית *</label><input id="ahHouseNumber" name="houseNumber" maxlength="20" required></div><div class="ahField"><label for="ahApartment">דירה</label><input id="ahApartment" name="apartment" maxlength="20"></div><div class="ahField"><label for="ahPostalCode">מיקוד</label><input id="ahPostalCode" name="postalCode" autocomplete="postal-code" maxlength="12"></div><div class="ahField full"><label for="ahNotes">הערות</label><textarea id="ahNotes" name="notes" maxlength="300"></textarea></div><div class="ahField full"><label for="ahCoupon">קוד קופון</label><input id="ahCoupon" maxlength="40"></div><input name="website" aria-hidden="true" style="position:absolute;left:-9999px" tabindex="-1"></div><label class="ahTerms"><input id="ahTerms" type="checkbox"><span>קראתי ואני מאשר את <a href="/policies" target="_blank">מדיניות ותנאי החנות</a>.</span></label><div class="ahCheckoutSummary"><div class="ahCheckoutSummaryRow"><span>סה״כ מוצרים</span><span id="ahProductsSubtotal">${money(cartTotal(entries))}</span></div><div class="ahCheckoutSummaryRow" id="ahDiscountRow" style="display:none"><span>הנחה</span><span id="ahDiscount" class="ahDiscount"></span></div><div class="ahCheckoutSummaryRow"><span>משלוח</span><span id="ahShippingCost" class="ahMuted">יחושב</span></div><div class="ahCheckoutSummaryRow" id="ahDeliveryMethodRow" style="display:none"><span>אופן מסירה</span><span id="ahDeliveryMethod" class="ahMuted">ייקבע לפי אפשרויות השילוח</span></div><div class="ahCheckoutSummaryRow" id="ahShipmentPlanRow" style="display:none"><span>משלוחים</span><span id="ahShipmentPlan"></span></div><div class="ahCheckoutSummaryRow" id="ahImportTaxRow" style="display:none"><span>מסי יבוא אפשריים — לא נגבים באתר</span><span id="ahImportTax"></span></div><div class="ahCheckoutSummaryRow total"><span>סה״כ</span><span id="ahGrandTotal">${money(cartTotal(entries))}</span></div><small id="ahShippingStatus" class="ahMuted">העלות ואופן המשלוח יחושבו לפי הכתובת.</small></div><label class="ahTerms" id="ahImportConsentWrap" style="display:none"><input id="ahImportConsent" type="checkbox"><span>הבנתי שייתכנו מסי יבוא/שחרור שאינם נגבים באתר.</span></label><div class="ahCheckoutError" id="ahCheckoutError"></div><button class="ahCheckoutSubmit" id="ahCheckoutSubmit" type="submit" data-stage="quote">בדיקת פרטים והמשך</button></form>`;
    enhanceCheckoutForm(entries);document.getElementById('ahCheckoutForm').addEventListener('submit',submitCheckout);open();
  }

  overlay.querySelector('.ahCheckoutClose').addEventListener('click',close);
  overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  window.checkoutNotice=renderForm;
  finishPayPalReturn().catch(()=>{});
  finishWhopReturn().catch(()=>{});
})();
