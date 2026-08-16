(() => {
  const style = document.createElement('style');
  style.textContent = `
    .ahCheckout{display:none;position:fixed;inset:0;background:#000b;z-index:170;padding:18px;place-items:center}
    .ahCheckout.open{display:grid}
    .ahCheckoutCard{width:min(720px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 80px #0006}
    .ahCheckoutHead{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid #e5e7eb;position:sticky;top:0;background:#fff;z-index:2}
    .ahCheckoutHead h2{margin:0;font-size:24px}.ahCheckoutClose{border:0;background:#f0f2f5;width:40px;height:40px;border-radius:10px}
    .ahCheckoutBody{padding:20px}.ahCheckoutNote{background:#fff8d8;border:1px solid #f3d66a;border-radius:12px;padding:12px 14px;margin-bottom:16px;font-size:13px;line-height:1.5}
    .ahCheckoutGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ahField{display:flex;flex-direction:column;gap:6px}.ahField.full{grid-column:1/-1}
    .ahField label{font-size:13px;font-weight:800}.ahField input,.ahField textarea{width:100%;border:1px solid #cfd5dc;border-radius:10px;padding:12px;font:inherit;background:#fff}.ahField textarea{min-height:78px;resize:vertical}
    .ahCheckoutSummary{margin:18px 0;border-top:1px solid #e5e7eb;padding-top:14px}.ahCheckoutSummaryRow{display:flex;justify-content:space-between;gap:12px;padding:5px 0}.ahCheckoutSummaryRow.total{font-size:19px;font-weight:950}.ahShippingPending{color:#68717c}.ahShippingFree{color:#208b4b;font-weight:900}
    .ahCheckoutSubmit{width:100%;height:50px;border:0;border-radius:11px;background:#ffc928;color:#15100a;font-weight:950}.ahCheckoutSubmit:disabled{opacity:.55;cursor:not-allowed}
    .ahCheckoutError{display:none;color:#b42318;background:#fff0ee;border:1px solid #ffc9c2;border-radius:10px;padding:10px 12px;margin:12px 0;font-size:13px}.ahCheckoutError.show{display:block}
    .ahCheckoutSuccess{text-align:center;padding:38px 20px}.ahCheckoutSuccess h2{margin:0 0 10px}.ahOrderId{display:inline-block;background:#111923;color:#fff;padding:9px 13px;border-radius:9px;font-weight:900;margin:8px 0 14px;direction:ltr}
    @media(max-width:620px){.ahCheckout{padding:8px}.ahCheckoutGrid{grid-template-columns:1fr}.ahField.full{grid-column:auto}.ahCheckoutCard{border-radius:14px}.ahCheckoutBody{padding:16px}}
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'ahCheckout';
  overlay.id = 'ahCheckout';
  overlay.innerHTML = `
    <div class="ahCheckoutCard" role="dialog" aria-modal="true" aria-labelledby="ahCheckoutTitle">
      <div class="ahCheckoutHead"><h2 id="ahCheckoutTitle">פרטי משלוח</h2><button class="ahCheckoutClose" type="button" aria-label="סגירה">✕</button></div>
      <div class="ahCheckoutBody" id="ahCheckoutBody"></div>
    </div>`;
  document.body.appendChild(overlay);

  const bodyBox = document.getElementById('ahCheckoutBody');
  const closeButton = overlay.querySelector('.ahCheckoutClose');

  function currentCartEntries() {
    const saved = (() => { try { return JSON.parse(localStorage.getItem('alufCart') || '{}'); } catch { return {}; } })();
    return Object.entries(saved).filter(([, qty]) => Number(qty) > 0);
  }

  function productList() {
    try { return typeof products !== 'undefined' && Array.isArray(products) ? products : []; } catch { return []; }
  }

  function money(value) {
    return '₪' + Number(value || 0).toFixed(2);
  }

  function cartTotal(entries) {
    const list = productList();
    return entries.reduce((sum, [id, qty]) => {
      const product = list.find((p) => String(p.id) === String(id));
      return sum + (product ? Number(product.price || 0) * Number(qty) : 0);
    }, 0);
  }

  function closeCheckout() {
    overlay.classList.remove('open');
  }

  function renderForm() {
    const entries = currentCartEntries();
    if (!entries.length) {
      bodyBox.innerHTML = '<div class="empty">הסל ריק. הוסף מוצר לפני מעבר להזמנה.</div>';
      overlay.classList.add('open');
      return;
    }

    const total = cartTotal(entries);
    bodyBox.innerHTML = `
      <div class="ahCheckoutNote"><b>המערכת עדיין בהכנה.</b> כרגע לא מתבצע חיוב ולא נשלחת הזמנה ל‑AliExpress.</div>
      <form id="ahCheckoutForm" novalidate>
        <div class="ahCheckoutGrid">
          <div class="ahField full"><label for="ahFullName">שם מלא *</label><input id="ahFullName" name="fullName" autocomplete="name" maxlength="80" required></div>
          <div class="ahField"><label for="ahPhone">טלפון *</label><input id="ahPhone" name="phone" inputmode="tel" autocomplete="tel" maxlength="20" required></div>
          <div class="ahField"><label for="ahEmail">אימייל</label><input id="ahEmail" name="email" type="email" autocomplete="email" maxlength="120"></div>
          <div class="ahField"><label for="ahCity">עיר / יישוב *</label><input id="ahCity" name="city" autocomplete="address-level2" maxlength="80" required></div>
          <div class="ahField"><label for="ahStreet">רחוב *</label><input id="ahStreet" name="street" autocomplete="address-line1" maxlength="100" required></div>
          <div class="ahField"><label for="ahHouse">מספר בית *</label><input id="ahHouse" name="houseNumber" maxlength="20" required></div>
          <div class="ahField"><label for="ahApartment">דירה</label><input id="ahApartment" name="apartment" maxlength="20"></div>
          <div class="ahField"><label for="ahPostal">מיקוד</label><input id="ahPostal" name="postalCode" inputmode="numeric" maxlength="12" autocomplete="postal-code"></div>
          <div class="ahField full"><label for="ahNotes">הערות למשלוח</label><textarea id="ahNotes" name="notes" maxlength="300"></textarea></div>
          <div class="ahField full" style="position:absolute;left:-9999px" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
        </div>
        <div class="ahCheckoutSummary">
          <div class="ahCheckoutSummaryRow"><span>מוצרים</span><span>${entries.reduce((s,[,q])=>s+Number(q),0)}</span></div>
          <div class="ahCheckoutSummaryRow"><span>סה״כ מוצרים</span><span id="ahProductsSubtotal">${money(total)}</span></div>
          <div class="ahCheckoutSummaryRow"><span>משלוח</span><span id="ahShippingCost" class="ahShippingPending">יחושב לפי הכתובת</span></div>
          <div class="ahCheckoutSummaryRow total"><span>סה״כ</span><span id="ahGrandTotal">${money(total)}</span></div>
          <div class="ahCheckoutSummaryRow"><small id="ahShippingStatus">לפני תשלום המערכת תבדוק את עלות המשלוח מול AliExpress.</small></div>
        </div>
        <div class="ahCheckoutError" id="ahCheckoutError"></div>
        <button class="ahCheckoutSubmit" id="ahCheckoutSubmit" type="submit" data-stage="quote">בדיקת משלוח והמשך</button>
      </form>`;

    const form = document.getElementById('ahCheckoutForm');
    form.addEventListener('submit', submitCheckout);
    form.addEventListener('input', () => {
      const submit = document.getElementById('ahCheckoutSubmit');
      if (!submit || submit.dataset.stage === 'quote') return;
      submit.dataset.stage = 'quote';
      submit.textContent = 'בדיקת משלוח והמשך';
      const shipping = document.getElementById('ahShippingCost');
      const grand = document.getElementById('ahGrandTotal');
      const status = document.getElementById('ahShippingStatus');
      if (shipping) { shipping.textContent = 'יחושב לפי הכתובת'; shipping.className = 'ahShippingPending'; }
      if (grand) grand.textContent = money(cartTotal(currentCartEntries()));
      if (status) status.textContent = 'פרטי המשלוח השתנו — נבצע בדיקה מחדש.';
    });
    overlay.classList.add('open');
    setTimeout(() => document.getElementById('ahFullName')?.focus(), 50);
  }

  function showError(message) {
    const box = document.getElementById('ahCheckoutError');
    if (!box) return;
    box.textContent = message;
    box.classList.add('show');
  }

  function collectCustomer(form) {
    const data = new FormData(form);
    if (String(data.get('website') || '').trim()) return null;
    return {
      fullName: String(data.get('fullName') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      email: String(data.get('email') || '').trim(),
      city: String(data.get('city') || '').trim(),
      street: String(data.get('street') || '').trim(),
      houseNumber: String(data.get('houseNumber') || '').trim(),
      apartment: String(data.get('apartment') || '').trim(),
      postalCode: String(data.get('postalCode') || '').trim(),
      notes: String(data.get('notes') || '').trim(),
      countryCode: 'IL'
    };
  }

  function validateCustomer(customer) {
    if (!customer) return 'אירעה שגיאה בטופס.';
    if (customer.fullName.length < 2 || customer.city.length < 2 || customer.street.length < 2 || !customer.houseNumber) {
      return 'יש למלא שם מלא וכתובת משלוח מלאה.';
    }
    const phoneDigits = customer.phone.replace(/\D/g, '');
    if (phoneDigits.length < 8 || phoneDigits.length > 15) return 'מספר הטלפון לא נראה תקין.';
    if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) return 'כתובת האימייל לא נראית תקינה.';
    return null;
  }

  async function postOrderPayload(entries, customer, quoteOnly) {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: entries.map(([id, qty]) => ({ id, qty: Number(qty) })),
        customer,
        quoteOnly
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      if (result.error === 'product_unavailable') throw new Error('אחד המוצרים כבר אינו זמין להזמנה.');
      if (result.error === 'invalid_customer') throw new Error('יש לבדוק את פרטי המשלוח ולנסות שוב.');
      throw new Error('לא הצלחנו לבדוק את ההזמנה כרגע. נסה שוב בעוד רגע.');
    }
    return result;
  }

  async function submitCheckout(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = document.getElementById('ahCheckoutSubmit');
    const customer = collectCustomer(form);
    const validationError = validateCustomer(customer);
    if (validationError) { showError(validationError); return; }

    const entries = currentCartEntries();
    if (!entries.length) { showError('הסל ריק.'); return; }

    submit.disabled = true;
    const errorBox = document.getElementById('ahCheckoutError');
    if (errorBox) errorBox.classList.remove('show');

    try {
      if (submit.dataset.stage === 'quote') {
        submit.textContent = 'בודק משלוח...';
        const quote = await postOrderPayload(entries, customer, true);
        const shipping = document.getElementById('ahShippingCost');
        const grand = document.getElementById('ahGrandTotal');
        const status = document.getElementById('ahShippingStatus');

        if (quote.shippingStatus === 'quoted') {
          if (shipping) {
            shipping.textContent = Number(quote.shippingCost || 0) <= 0 ? 'חינם' : money(quote.shippingCost);
            shipping.className = Number(quote.shippingCost || 0) <= 0 ? 'ahShippingFree' : '';
          }
          if (grand) grand.textContent = money(quote.total);
          if (status) status.textContent = 'עלות המשלוח נבדקה מול AliExpress.';
          submit.dataset.stage = 'finalize';
          submit.textContent = 'אישור ושמירת הזמנה';
          submit.disabled = false;
          return;
        }

        if (quote.waitingForAliExpressPermission) {
          if (shipping) { shipping.textContent = 'ממתין לחיבור AliExpress'; shipping.className = 'ahShippingPending'; }
          if (status) status.textContent = 'ההרשאה של AliExpress עדיין לא נפתחה. לא יתבצע חיוב.';
          submit.dataset.stage = 'finalize-pending';
          submit.textContent = 'שמור טיוטה';
          submit.disabled = false;
          return;
        }

        throw new Error('לא נמצאה כרגע אפשרות משלוח תקינה לכתובת הזאת.');
      }

      submit.textContent = 'שומר...';
      const result = await postOrderPayload(entries, customer, false);
      const shippingLine = result.shippingStatus === 'quoted'
        ? `<p>משלוח: <b>${Number(result.shippingCost || 0) <= 0 ? 'חינם' : money(result.shippingCost)}</b></p>`
        : '<p style="color:#68717c">עלות המשלוח עדיין ממתינה לחיבור AliExpress ולא בוצע חיוב.</p>';

      bodyBox.innerHTML = `
        <div class="ahCheckoutSuccess">
          <div style="font-size:46px">✓</div>
          <h2>הטיוטה נשמרה</h2>
          <p>מספר ההזמנה שלך:</p>
          <div class="ahOrderId">${String(result.orderId || '')}</div>
          ${shippingLine}
          <p><b>סה״כ כרגע: ${money(result.total)}</b></p>
          <p style="color:#68717c;line-height:1.6">לא בוצע חיוב ולא נשלחה הזמנה לספק. כשנחבר את הסליקה, התשלום יוכל להמשיך רק אחרי בדיקת מחיר המשלוח.</p>
          <button class="ahCheckoutSubmit" type="button" id="ahCheckoutDone">סגור</button>
        </div>`;
      document.getElementById('ahCheckoutDone')?.addEventListener('click', closeCheckout);
    } catch (error) {
      showError(error.message || 'אירעה שגיאה.');
      submit.disabled = false;
      if (submit.dataset.stage === 'quote') submit.textContent = 'בדיקת משלוח והמשך';
      else if (submit.dataset.stage === 'finalize-pending') submit.textContent = 'שמור טיוטה';
      else submit.textContent = 'אישור ושמירת הזמנה';
    }
  }

  closeButton.addEventListener('click', closeCheckout);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) closeCheckout(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeCheckout(); });

  window.checkoutNotice = renderForm;
})();
