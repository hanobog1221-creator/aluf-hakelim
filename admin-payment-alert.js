(() => {
  const STYLE_ID = 'ah-aliexpress-payment-alert-style';
  const PANEL_ID = 'ahAliPaymentAlert';
  let timer = null;
  let loading = false;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .ahAliPayAlert{background:#fff7cf;border:2px solid #e6bd2f;border-radius:15px;padding:14px 15px;margin:0 0 14px;box-shadow:0 8px 22px #00000012}
      .ahAliPayAlertHead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
      .ahAliPayAlertTitle{font-size:17px;font-weight:950;color:#5d4300}.ahAliPayAlertTitle b{display:inline-flex;min-width:25px;height:25px;align-items:center;justify-content:center;background:#5d4300;color:#fff;border-radius:999px;margin-inline-start:6px;font-size:13px}
      .ahAliPayAlertSub{font-size:12px;color:#715b18;line-height:1.55;margin-top:4px}
      .ahAliPayAlertRows{display:grid;gap:8px;margin-top:11px}.ahAliPayAlertRow{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#fff;border:1px solid #eadb99;border-radius:10px;padding:10px;flex-wrap:wrap}
      .ahAliPayAlertMeta{font-size:12px;line-height:1.55;color:#454545}.ahAliPayAlertMeta strong{display:block;font-size:13px;color:#171717}
      .ahAliPayAlertActions{display:flex;gap:7px;flex-wrap:wrap}.ahAliPayAlertActions a{border-radius:9px;padding:9px 11px;text-decoration:none;font-size:12px;font-weight:950;display:inline-flex;align-items:center;justify-content:center}
      .ahAliPayPrimary{background:#ffc928;color:#17120b}.ahAliPaySecondary{background:#111923;color:#fff}.ahAliPayAlertError{background:#fff0f0;border-color:#ffc8cb;color:#8a1721}
      @media(max-width:560px){.ahAliPayAlertActions,.ahAliPayAlertActions a{width:100%}.ahAliPayAlertRow{align-items:stretch}}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    ensureStyle();
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    const app = document.getElementById('app');
    if (!app) return null;
    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'ahAliPayAlert hidden';
    app.insertBefore(panel, app.firstChild);
    return panel;
  }

  function directPaymentLink(row) {
    const links = Array.isArray(row?.paymentLinks) ? row.paymentLinks : [];
    return links.find((x) => x?.url)?.url || '';
  }

  function render(rows) {
    const panel = ensurePanel();
    if (!panel) return;
    const actionable = (Array.isArray(rows) ? rows : []).filter((row) => row?.action === 'pay_supplier' || row?.action === 'review' || row?.action === 'create_supplier_order');
    if (!actionable.length) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
      return;
    }

    const paymentRows = actionable.filter((row) => row.action === 'pay_supplier');
    const title = paymentRows.length
      ? `יש ${paymentRows.length} הזמנ${paymentRows.length === 1 ? 'ה' : 'ות'} שמחכ${paymentRows.length === 1 ? 'ה' : 'ות'} לתשלום ב‑AliExpress`
      : `יש ${actionable.length} הזמנ${actionable.length === 1 ? 'ה שדורשת' : 'ות שדורשות'} טיפול בספק`;

    const preview = actionable.slice(0, 3).map((row) => {
      const customer = row.customer || {};
      const link = directPaymentLink(row);
      const actionText = row.action === 'pay_supplier' ? 'ממתינה לתשלום' : row.action === 'create_supplier_order' ? 'צריך ליצור הזמנת ספק' : 'דורשת בדיקה';
      return `<div class="ahAliPayAlertRow"><div class="ahAliPayAlertMeta"><strong>${esc(row.orderId)} · ${esc(customer.fullName || 'לקוח')}</strong>${esc(actionText)}${customer.city ? ` · ${esc(customer.city)}` : ''}</div><div class="ahAliPayAlertActions">${link ? `<a class="ahAliPayPrimary" target="_blank" rel="noopener noreferrer" href="${esc(link)}">פתח תשלום ב‑AliExpress</a>` : ''}<a class="ahAliPaySecondary" href="/admin-aliexpress-payments.html">פתח פרטי הזמנה</a></div></div>`;
    }).join('');

    panel.className = 'ahAliPayAlert';
    panel.innerHTML = `<div class="ahAliPayAlertHead"><div><div class="ahAliPayAlertTitle">⚠️ ${esc(title)} <b>${actionable.length}</b></div><div class="ahAliPayAlertSub">ההזמנה אצל AliExpress כבר נוצרת עם שם, טלפון וכתובת המשלוח של הלקוח. אחרי התשלום חזור לתור ולחץ “בדוק ששולם”.</div></div><div class="ahAliPayAlertActions"><a class="ahAliPaySecondary" href="/admin-aliexpress-payments.html">כל תור התשלומים</a></div></div><div class="ahAliPayAlertRows">${preview}</div>`;
  }

  async function refresh() {
    if (loading || document.visibilityState !== 'visible') return;
    const app = document.getElementById('app');
    if (!app || app.classList.contains('hidden')) return;
    loading = true;
    try {
      const response = await fetch('/api/admin?route=aliexpress-payment-queue', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (response.status === 401) {
        render([]);
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error || 'request_failed');
      render(data.rows || []);
    } catch (error) {
      const panel = ensurePanel();
      if (panel && !panel.classList.contains('hidden')) {
        panel.classList.add('ahAliPayAlertError');
      }
    } finally {
      loading = false;
    }
  }

  function start() {
    ensurePanel();
    refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, 30000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  window.addEventListener('focus', refresh);
  window.addEventListener('ah-admin-authenticated', refresh);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
