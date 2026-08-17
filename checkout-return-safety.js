(() => {
  const PARAM_KEY = 'alufPayPalReturnContext';
  const LAST_ORDER_KEY = 'alufLastOrderId';

  function clean(value, max = 120) { return String(value || '').trim().slice(0, max); }
  function validOrderId(value) { return /^AH-[A-Z0-9-]{5,60}$/.test(clean(value, 80).toUpperCase()); }
  function saveReturnContext() {
    try {
      const params = new URLSearchParams(location.search);
      if (params.get('paypal') !== 'approved') return;
      const orderId = clean(params.get('storeOrderId'), 80).toUpperCase();
      const paypalOrderId = clean(params.get('token'), 80);
      if (!validOrderId(orderId) || !paypalOrderId) return;
      sessionStorage.setItem(PARAM_KEY, JSON.stringify({ orderId, paypalOrderId, savedAt: Date.now() }));
    } catch {}
  }
  function returnContext() {
    try {
      const row = JSON.parse(sessionStorage.getItem(PARAM_KEY) || 'null');
      if (!row || !validOrderId(row.orderId) || !clean(row.paypalOrderId, 80)) return null;
      if (Date.now() - Number(row.savedAt || 0) > 2 * 60 * 60 * 1000) {
        sessionStorage.removeItem(PARAM_KEY);
        return null;
      }
      return { orderId: clean(row.orderId, 80).toUpperCase(), paypalOrderId: clean(row.paypalOrderId, 80) };
    } catch { return null; }
  }
  function clearContext() { try { sessionStorage.removeItem(PARAM_KEY); } catch {} }
  function rememberOrder(orderId) { try { localStorage.setItem(LAST_ORDER_KEY, orderId); } catch {} }
  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); return true; }
    catch { try { window.prompt('העתק את מספר ההזמנה:', value); return true; } catch { return false; } }
  }
  async function captureAgain(ctx) {
    const response = await fetch('/api/paypal?action=capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ orderId: ctx.orderId, paypalOrderId: ctx.paypalOrderId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) {
      const error = new Error(String(data.error || 'capture_retry_failed'));
      error.code = data.error || 'capture_retry_failed';
      throw error;
    }
    return data;
  }
  function retryMessage(code) {
    if (code === 'paypal_payment_recovery_mismatch' || code === 'paypal_order_mismatch') return 'לא הצלחנו להתאים את החזרה מ‑PayPal להזמנה. פנה אלינו עם מספר ההזמנה.';
    if (code === 'paypal_live_required' || code === 'supplier_live_not_enabled' || code === 'supplier_autopay_required') return 'מערכת התשלום החיה עדיין לא הופעלה.';
    return 'לא הצלחנו לאמת את התשלום כרגע. אפשר לנסות שוב עם אותו תשלום — לא נוצר חיוב חדש.';
  }
  function actionsMarkup(orderId) {
    return `<div id="ahPostPayActions" style="max-width:460px;margin:16px auto 0;display:grid;gap:9px">
      <button class="ahCheckoutSubmit" id="ahCopyOrderId" type="button" style="background:#eef1f4">העתק מספר הזמנה</button>
      <a class="ahCheckoutSubmit" id="ahTrackOrder" href="/track?order=${encodeURIComponent(orderId)}" style="display:grid;place-items:center;text-decoration:none">מעקב אחר ההזמנה</a>
    </div>`;
  }
  function renderRecoveredSuccess(box, orderId, recovered = false) {
    rememberOrder(orderId);
    clearContext();
    try { localStorage.removeItem('alufCart'); sessionStorage.removeItem('alufPendingPayPalOrder'); } catch {}
    box.innerHTML = `<div style="font-size:46px">✓</div><h2>התשלום הושלם</h2><p>${recovered ? 'התשלום כבר היה מאומת ושוחזר בהצלחה.' : 'ההזמנה אומתה בשרת והועברה למנגנון הטיפול.'}</p><div class="ahOrderId">${orderId}</div><p class="ahMuted">שמור את מספר ההזמנה. בעמוד המעקב תתבקש להזין גם את מספר הטלפון מההזמנה.</p>${actionsMarkup(orderId)}<button class="ahCheckoutSubmit" id="ahDone" type="button" style="margin-top:12px;background:#eef1f4">סגור</button>`;
    document.getElementById('ahCopyOrderId')?.addEventListener('click', async () => {
      const btn = document.getElementById('ahCopyOrderId');
      if (await copyText(orderId)) { btn.textContent = 'מספר ההזמנה הועתק ✓'; setTimeout(() => { if (btn) btn.textContent = 'העתק מספר הזמנה'; }, 1800); }
    });
    document.getElementById('ahDone')?.addEventListener('click', () => document.querySelector('.ahCheckout')?.classList.remove('open'));
    try { if (typeof renderCart === 'function') renderCart(); } catch {}
  }
  function enhanceSuccess(box) {
    if (box.dataset.ahReturnEnhanced === '1') return;
    const orderId = clean(box.querySelector('.ahOrderId')?.textContent, 80).toUpperCase();
    if (!validOrderId(orderId)) return;
    box.dataset.ahReturnEnhanced = '1';
    rememberOrder(orderId);
    clearContext();
    Array.from(box.querySelectorAll('p')).forEach((p) => { if (/PayPal\s*Capture/i.test(p.textContent || '')) p.remove(); });
    if (!box.querySelector('#ahPostPayActions')) {
      const done = box.querySelector('#ahDone');
      const holder = document.createElement('div');
      holder.innerHTML = `<p class="ahMuted">שמור את מספר ההזמנה. בעמוד המעקב תתבקש להזין גם את מספר הטלפון מההזמנה.</p>${actionsMarkup(orderId)}`;
      while (holder.firstChild) box.insertBefore(holder.firstChild, done || null);
      document.getElementById('ahCopyOrderId')?.addEventListener('click', async () => {
        const btn = document.getElementById('ahCopyOrderId');
        if (await copyText(orderId)) { btn.textContent = 'מספר ההזמנה הועתק ✓'; setTimeout(() => { if (btn) btn.textContent = 'העתק מספר הזמנה'; }, 1800); }
      });
    }
  }
  function enhanceFailure(box) {
    if (box.dataset.ahRetryAdded === '1') return;
    const ctx = returnContext();
    if (!ctx) return;
    const visibleOrder = clean(box.querySelector('.ahOrderId')?.textContent, 80).toUpperCase();
    if (visibleOrder && visibleOrder !== ctx.orderId) return;
    box.dataset.ahRetryAdded = '1';
    const button = document.createElement('button');
    button.className = 'ahCheckoutSubmit';
    button.type = 'button';
    button.textContent = 'נסה שוב לאמת את אותו תשלום';
    button.style.marginTop = '12px';
    const status = document.createElement('p');
    status.className = 'ahPayPalStatus';
    status.textContent = 'Retry משתמש באותה הזמנה ואותו PayPal Order — לא נוצר תשלום חדש.';
    const done = box.querySelector('#ahDone');
    box.insertBefore(status, done || null);
    box.insertBefore(button, done || null);
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'מאמת שוב…';
      status.textContent = 'בודק את אותו תשלום מול השרת…';
      try {
        const out = await captureAgain(ctx);
        renderRecoveredSuccess(box, out.orderId || ctx.orderId, out.recovered === true || out.alreadyPaid === true);
      } catch (error) {
        status.textContent = retryMessage(error.code || error.message);
        button.disabled = false;
        button.textContent = 'נסה שוב לאמת את אותו תשלום';
      }
    });
  }
  function inspect() {
    document.querySelectorAll('.ahCheckoutSuccess').forEach((box) => {
      const text = String(box.textContent || '');
      if (text.includes('התשלום הושלם')) enhanceSuccess(box);
      else if (text.includes('התשלום לא סומן כמושלם')) enhanceFailure(box);
    });
  }

  saveReturnContext();
  const observer = new MutationObserver(inspect);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', inspect, { once: true });
  setTimeout(inspect, 50);
})();
