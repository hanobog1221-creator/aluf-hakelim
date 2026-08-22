(() => {
  const style = document.createElement('style');
  style.textContent = `
  .ahCheckout{display:none;position:fixed;inset:0;background:#000b;z-index:170;padding:18px;place-items:center}.ahCheckout.open{display:grid}
  .ahCheckoutCard{width:min(720px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 80px #0006}.ahCheckoutHead{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid #e5e7eb;position:sticky;top:0;background:#fff;z-index:2}.ahCheckoutHead h2{margin:0;font-size:24px}.ahCheckoutClose{border:0;background:#f0f2f5;width:40px;height:40px;border-radius:10px}.ahCheckoutBody{padding:20px}
  .ahCheckoutNote{background:#fff8d8;border:1px solid #f3d66a;border-radius:12px;padding:12px 14px;margin-bottom:16px;font-size:13px;line-height:1.5}.ahCheckoutGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ahField{display:flex;flex-direction:column;gap:6px}.ahField.full{grid-column:1/-1}.ahField label{font-size:13px;font-weight:800}.ahField input,.ahField textarea{width:100%;border:1px solid #cfd5dc;border-radius:10px;padding:12px;font:inherit;background:#fff}.ahField textarea{min-height:74px}.ahTerms{display:flex;align-items:flex-start;gap:9px;margin:14px 0;padding:11px 12px;border:1px solid #e0e4e8;border-radius:10px;background:#fafbfc;font-size:13px;line-height:1.55}.ahTerms input{width:18px;height:18px;flex:0 0 auto}.ahTerms a{font-weight:900;color:#111923}.ahCheckoutSummary{margin:18px 0;border-top:1px solid #e5e7eb;padding-top:14px}.ahCheckoutSummaryRow{display:flex;justify-content:space-between;gap:12px;padding:5px 0}.ahCheckoutSummaryRow.total{font-size:19px;font-weight:950}.ahDiscount{color:#197342;font-weight:900}.ahMuted{color:#68717c}.ahCheckoutSubmit{width:100%;height:50px;border:0;border-radius:11px;background:#ffc928;color:#15100a;font-weight:950;cursor:pointer}.ahCheckoutSubmit:disabled{opacity:.55;cursor:not-allowed}.ahCheckoutError{display:none;color:#b42318;background:#fff0ee;border:1px solid #ffc9c2;border-radius:10px;padding:10px 12px;margin:12px 0;font-size:13px}.ahCheckoutError.show{display:block}.ahCheckoutSuccess{text-align:center;padding:30px 18px}.ahOrderId{display:inline-block;background:#111923;color:#fff;padding:9px 13px;border-radius:9px;font-weight:900;margin:8px 0 14px;direction:ltr}.ahPayPalWrap{margin:18px auto 0;max-width:460px}.ahPayPalBadge{display:inline-block;background:#e8f1ff;color:#173b69;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:900}.ahPayPalStatus{color:#68717c;line-height:1.55;margin:10px 0}
  @media(max-width:620px){.ahCheckout{padding:8px}.ahCheckoutGrid{grid-template-columns:1fr}.ahField.full{grid-column:auto}.ahCheckoutCard{border-radius:14px}.ahCheckoutBody{padding:16px}}
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'ahCheckout';
  overlay.innerHTML = `<div class="ahCheckoutCard" role="dialog" aria-modal="true"><div class="ahCheckoutHead"><h2>פרטי משלוח ותשלום</h2><button class="ahCheckoutClose" type="button">✕</button></div><div class="ahCheckoutBody" id="ahCheckoutBody"></div></div>`;
  document.body.appendChild(overlay);
  const bodyBox = overlay.querySelector('#ahCheckoutBody');
  let currentAttemptId = null;

  const money = (v) => '₪' + Number(v || 0).toFixed(2);
  const deliveryMethodLabel = (value) => ({home_delivery:'משלוח עד הבית',pickup_point:'נקודת איסוף / לוקר',mixed:'מסירה משולבת',unknown:'ייקבע לפי אפשרויות השילוח'}[String(value||'unknown')] || 'ייקבע לפי אפשרויות השילוח');
  const cartEntries = () => { try { return Object.entries(JSON.parse(localStorage.getItem('alufCart') || '{}')).filter(([,q]) => Number(q) > 0); } catch { return []; } };
  const productList = () => { try { return Array.isArray(products) ? products : []; } catch { return []; } };
  const cartTotal = (entries) => entries.reduce((sum,[id,qty]) => { const p=productList().find(x=>String(x.id)===String(id)); return sum+(p?Number(p.price||0)*Number(qty):0); },0);
  const attemptId = () => 'req_' + (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`);
  const close = () => overlay.classList.remove('open');
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
    bodyBox.innerHTML=`<div class="ahCheckoutSuccess"><span class="ahPayPalBadge">תשלום מאובטח</span><h2>ההזמנה מוכנה לתשלום</h2><div class="ahOrderId">${String(result.orderId||'')}</div><p>מוצרים: <b>${money(result.discountedProductsSubtotal??result.productsSubtotal)}</b></p><p>משלוח: <b>${money(result.shippingCost||0)}</b></p><p>אופן מסירה: <b>${deliveryMethodLabel(result.deliveryMethod)}</b></p><p><b>סה״כ לחיוב: ${money(result.total)}</b></p><p id="ahPayPalStatus" class="ahPayPalStatus">עדיין לא בוצע חיוב.</p><div class="ahPayPalWrap"><button class="ahCheckoutSubmit" id="ahPayPalRedirect" type="button">המשך לתשלום מאובטח</button></div><button class="ahCheckoutSubmit" id="ahCloseNoPay" type="button" style="margin-top:12px;background:#eef1f4">סגור בלי לשלם</button></div>`;
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
    overlay.classList.add('open');
    if(state==='cancelled') {
      bodyBox.innerHTML=`<div class="ahCheckoutSuccess"><h2>התשלום בוטל</h2><p>לא בוצע Capture ב-PayPal.</p>${/^AH-[A-Z0-9-]{5,60}$/.test(orderId)?`<div class="ahOrderId">${orderId}</div>`:''}<button class="ahCheckoutSubmit" id="ahDone">חזרה לחנות</button></div>`;
      document.getElementById('ahDone')?.addEventListener('click',close);
      return;
    }
    if(!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)||!paypalOrderId) {
      bodyBox.innerHTML='<div class="ahCheckoutSuccess"><h2>לא ניתן לאמת את החזרה מ-PayPal</h2><p class="ahMuted">לא בוצע סימון תשלום.</p><button class="ahCheckoutSubmit" id="ahDone">סגור</button></div>';
      document.getElementById('ahDone')?.addEventListener('click',close);
      return;
    }
    bodyBox.innerHTML=`<div class="ahCheckoutSuccess"><h2>מאמת תשלום…</h2><div class="ahOrderId">${orderId}</div><p id="ahReturnStatus" class="ahPayPalStatus">מבצע Capture מאובטח מול PayPal.</p></div>`;
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
    overlay.classList.add('open');
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
    if(!entries.length){bodyBox.innerHTML='<div class="ahMuted" style="padding:30px;text-align:center">הסל ריק.</div>';overlay.classList.add('open');return;}
    bodyBox.innerHTML=`<div class="ahCheckoutNote"><b>תשלום מאובטח.</b> לפני התשלום נוודא שהמחיר, המלאי והמשלוח עדכניים.</div><form id="ahCheckoutForm"><div class="ahCheckoutGrid"><div class="ahField full"><label>שם מלא *</label><input name="fullName" maxlength="80" required></div><div class="ahField"><label>טלפון *</label><input name="phone" maxlength="20" required></div><div class="ahField"><label>אימייל</label><input name="email" type="email" maxlength="120"></div><div class="ahField"><label>עיר *</label><input name="city" maxlength="80" required></div><div class="ahField"><label>רחוב *</label><input name="street" maxlength="100" required></div><div class="ahField"><label>מספר בית *</label><input name="houseNumber" maxlength="20" required></div><div class="ahField"><label>דירה</label><input name="apartment" maxlength="20"></div><div class="ahField"><label>מיקוד</label><input name="postalCode" maxlength="12"></div><div class="ahField full"><label>הערות</label><textarea name="notes" maxlength="300"></textarea></div><div class="ahField full"><label>קוד קופון</label><input id="ahCoupon" maxlength="40"></div><input name="website" style="position:absolute;left:-9999px" tabindex="-1"></div><label class="ahTerms"><input id="ahTerms" type="checkbox"><span>קראתי ואני מאשר את <a href="/policies" target="_blank">מדיניות ותנאי החנות</a>.</span></label><div class="ahCheckoutSummary"><div class="ahCheckoutSummaryRow"><span>סה״כ מוצרים</span><span id="ahProductsSubtotal">${money(cartTotal(entries))}</span></div><div class="ahCheckoutSummaryRow" id="ahDiscountRow" style="display:none"><span>הנחה</span><span id="ahDiscount" class="ahDiscount"></span></div><div class="ahCheckoutSummaryRow"><span>משלוח</span><span id="ahShippingCost" class="ahMuted">יחושב</span></div><div class="ahCheckoutSummaryRow" id="ahDeliveryMethodRow" style="display:none"><span>אופן מסירה</span><span id="ahDeliveryMethod" class="ahMuted">ייקבע לפי אפשרויות השילוח</span></div><div class="ahCheckoutSummaryRow" id="ahShipmentPlanRow" style="display:none"><span>משלוחים</span><span id="ahShipmentPlan"></span></div><div class="ahCheckoutSummaryRow" id="ahImportTaxRow" style="display:none"><span>מסי יבוא אפשריים — לא נגבים באתר</span><span id="ahImportTax"></span></div><div class="ahCheckoutSummaryRow total"><span>סה״כ</span><span id="ahGrandTotal">${money(cartTotal(entries))}</span></div><small id="ahShippingStatus" class="ahMuted">העלות ואופן המשלוח יחושבו לפי הכתובת.</small></div><label class="ahTerms" id="ahImportConsentWrap" style="display:none"><input id="ahImportConsent" type="checkbox"><span>הבנתי שייתכנו מסי יבוא/שחרור שאינם נגבים באתר.</span></label><div class="ahCheckoutError" id="ahCheckoutError"></div><button class="ahCheckoutSubmit" id="ahCheckoutSubmit" type="submit" data-stage="quote">בדיקת פרטים והמשך</button></form>`;
    document.getElementById('ahCheckoutForm').addEventListener('submit',submitCheckout);overlay.classList.add('open');
  }

  overlay.querySelector('.ahCheckoutClose').addEventListener('click',close);
  overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  window.checkoutNotice=renderForm;
  finishPayPalReturn().catch(()=>{});
  finishWhopReturn().catch(()=>{});
})();
