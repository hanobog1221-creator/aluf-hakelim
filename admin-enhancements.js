(() => {
  const style = document.createElement('style');
  style.textContent = `
    .orderTools{display:grid;grid-template-columns:minmax(220px,1fr) 180px 180px auto;gap:8px;margin:0 0 14px}
    .orderTools input,.orderTools select{height:42px;border:1px solid #cfd5dc;border-radius:10px;background:#fff;padding:0 11px;font:inherit}
    .orderTools .btn{height:42px;padding:0 13px}.orderToolsInfo{grid-column:1/-1;color:#6f7b87;font-size:12px}
    .orderQuickActions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.orderQuickActions button,.orderQuickActions a{border:1px solid #d7dde3;background:#fff;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:900;text-decoration:none;color:#171717;cursor:pointer}.orderQuickActions .waCustomer{background:#effdf4;border-color:#a9e6be;color:#126832}
    .orderNotes{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}.orderNotes textarea{width:100%;min-height:72px;border:1px solid #cfd5dc;border-radius:10px;padding:10px;font:inherit;resize:vertical}.orderNotes label{font-size:12px;font-weight:900;display:block;margin-bottom:5px}.orderNotes small{display:block;color:#6f7b87;margin-top:4px;line-height:1.4}
    .productToolbarActions{display:flex;gap:7px;flex-wrap:wrap}
    @media(max-width:850px){.orderTools{grid-template-columns:1fr 1fr}.orderTools input{grid-column:1/-1}.orderTools .btn{width:100%}.orderNotes{grid-template-columns:1fr}}
    @media(max-width:520px){.orderTools{grid-template-columns:1fr}.orderTools input{grid-column:auto}}
  `;
  document.head.appendChild(style);

  let searchValue = '';
  let paymentFilter = 'all';
  let statusFilter = 'all';

  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('0')) digits = '972' + digits.slice(1);
    return digits;
  }

  function orderSearchText(order) {
    const c = order.customer || {};
    return [
      order.order_id,
      c.fullName,
      c.phone,
      c.city,
      c.street,
      order.tracking_number,
      order.coupon_code,
      ...(Array.isArray(order.items) ? order.items.map((item) => item.name) : [])
    ].filter(Boolean).join(' ').toLocaleLowerCase('he');
  }

  function visibleOrders() {
    const q = searchValue.trim().toLocaleLowerCase('he');
    return state.orders.filter((order) => {
      const matchSearch = !q || orderSearchText(order).includes(q);
      const matchPayment = paymentFilter === 'all' || String(order.payment_status) === paymentFilter;
      const matchStatus = statusFilter === 'all' || String(order.status) === statusFilter;
      return matchSearch && matchPayment && matchStatus;
    });
  }

  function csvCell(value) {
    return '"' + String(value ?? '').replace(/"/g, '""') + '"';
  }

  function downloadCsv(filename, rows) {
    const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportOrders() {
    const rows = visibleOrders();
    const header = ['מספר הזמנה','תאריך','לקוח','טלפון','עיר','כתובת','סכום','סטטוס תשלום','סטטוס הזמנה','מספר מעקב','קופון'];
    const lines = [header.map(csvCell).join(',')];
    for (const o of rows) {
      const c = o.customer || {};
      const address = [c.street, c.houseNumber, c.apartment && ('דירה ' + c.apartment), c.city, c.postalCode].filter(Boolean).join(', ');
      lines.push([
        o.order_id,
        o.created_at || '',
        c.fullName || '',
        c.phone || '',
        c.city || '',
        address,
        Number(o.total || 0) + Number(o.shipping_cost || 0),
        o.payment_status || '',
        o.status || '',
        o.tracking_number || '',
        o.coupon_code || ''
      ].map(csvCell).join(','));
    }
    downloadCsv(`aluf-hakelim-orders-${new Date().toISOString().slice(0,10)}.csv`, lines);
  }

  function exportProducts() {
    const header = ['מזהה','שם','מחיר מכירה','פעיל','Product ID','SKU ID','וריאנט','עלות ספק','משלוח ספק','מוכן לאוטומציה'];
    const lines = [header.map(csvCell).join(',')];
    for (const p of state.products) {
      lines.push([
        p.id,
        p.name,
        p.selling_price,
        p.active ? 'כן' : 'לא',
        p.supplier_product_id || '',
        p.supplier_sku_id || '',
        p.variant_label || '',
        p.supplier_price_ils ?? p.supplier_price ?? '',
        p.supplier_shipping ?? '',
        p.fulfillment_ready ? 'כן' : 'לא'
      ].map(csvCell).join(','));
    }
    downloadCsv(`aluf-hakelim-products-${new Date().toISOString().slice(0,10)}.csv`, lines);
  }

  async function copyText(value, button) {
    try {
      await navigator.clipboard.writeText(value);
      const old = button.textContent;
      button.textContent = 'הועתק ✓';
      setTimeout(() => button.textContent = old, 1200);
    } catch {}
  }

  function statusMessage(order) {
    if (order.fulfillment_status === 'delivered' || order.status === 'completed') return `היי ${order.customer?.fullName || ''}, הזמנה ${order.order_id} סומנה כנמסרה. תודה שקנית באלוף הכלים.`;
    if (order.fulfillment_status === 'shipped' || order.status === 'shipped') return `היי ${order.customer?.fullName || ''}, הזמנה ${order.order_id} נשלחה.${order.tracking_number ? ` מספר המעקב: ${order.tracking_number}` : ''}`;
    if (order.payment_status === 'paid') return `היי ${order.customer?.fullName || ''}, התשלום עבור הזמנה ${order.order_id} התקבל וההזמנה בטיפול.`;
    return `היי ${order.customer?.fullName || ''}, קיבלנו את פרטי הזמנה ${order.order_id}.`;
  }

  function decorateOrderCards() {
    const allowed = new Set(visibleOrders().map((o) => String(o.order_id)));
    const cards = Array.from(document.querySelectorAll('#ordersList [data-order]'));
    for (const card of cards) {
      const id = String(card.dataset.order || '');
      const order = state.orders.find((o) => String(o.order_id) === id);
      card.style.display = allowed.has(id) ? '' : 'none';
      if (!order) continue;

      if (!card.querySelector('.orderNotes')) {
        const body = card.querySelector('.cardBody');
        const notes = document.createElement('div');
        notes.className = 'orderNotes';
        notes.innerHTML = `
          <div><label>הערה פנימית — רק לך</label><textarea data-ok="admin_note" maxlength="2000" placeholder="לדוגמה: לבדוק כתובת לפני טיפול">${esc(order.admin_note || '')}</textarea><small>לא מוצג ללקוח.</small></div>
          <div><label>עדכון שיוצג ללקוח</label><textarea data-ok="customer_note" maxlength="800" placeholder="לדוגמה: ההזמנה צפויה לצאת למשלוח בקרוב">${esc(order.customer_note || '')}</textarea><small>יופיע בעמוד מעקב ההזמנה.</small></div>`;
        body?.appendChild(notes);
      }

      if (!card.querySelector('.orderQuickActions')) {
        const c = order.customer || {};
        const address = [c.street, c.houseNumber, c.apartment && ('דירה ' + c.apartment), c.city, c.postalCode].filter(Boolean).join(', ');
        const phone = normalizePhone(c.phone);
        const actions = document.createElement('div');
        actions.className = 'orderQuickActions';
        if (phone) {
          const wa = document.createElement('a');
          wa.className = 'waCustomer';
          wa.target = '_blank';
          wa.rel = 'noopener noreferrer';
          wa.href = `https://wa.me/${phone}?text=${encodeURIComponent(statusMessage(order))}`;
          wa.textContent = '💬 WhatsApp ללקוח';
          actions.appendChild(wa);
        }
        if (address) {
          const copyAddress = document.createElement('button');
          copyAddress.type = 'button';
          copyAddress.textContent = 'העתק כתובת';
          copyAddress.addEventListener('click', () => copyText(address, copyAddress));
          actions.appendChild(copyAddress);
        }
        const copyOrder = document.createElement('button');
        copyOrder.type = 'button';
        copyOrder.textContent = 'העתק מספר הזמנה';
        copyOrder.addEventListener('click', () => copyText(order.order_id, copyOrder));
        actions.appendChild(copyOrder);
        card.querySelector('.cardBody')?.appendChild(actions);
      }
    }

    const info = document.getElementById('orderToolsInfo');
    if (info) info.textContent = `${allowed.size} מתוך ${state.orders.length} הזמנות`;
  }

  function ensureTopLinks() {
    const topActions = document.querySelector('.topActions');
    if (!topActions || document.getElementById('launchChecklistLink')) return;
    const link = document.createElement('a');
    link.id = 'launchChecklistLink';
    link.href = '/launch-checklist';
    link.textContent = 'מוכנות להשקה';
    topActions.insertBefore(link, topActions.firstChild);
  }

  function ensureProductTools() {
    const toolbar = document.querySelector('#productsTab .toolbar');
    const newButton = document.getElementById('newProductBtn');
    if (!toolbar || !newButton || document.getElementById('exportProducts')) return;
    const actions = document.createElement('div');
    actions.className = 'productToolbarActions';
    const exportButton = document.createElement('button');
    exportButton.id = 'exportProducts';
    exportButton.className = 'btn small dark';
    exportButton.type = 'button';
    exportButton.textContent = 'ייצוא מוצרים';
    exportButton.addEventListener('click', exportProducts);
    newButton.parentNode.insertBefore(actions, newButton);
    actions.append(newButton, exportButton);
  }

  function ensureTools() {
    const ordersTab = document.getElementById('ordersTab');
    const toolbar = ordersTab?.querySelector('.toolbar');
    if (!ordersTab || !toolbar || document.getElementById('orderTools')) return;
    const tools = document.createElement('div');
    tools.id = 'orderTools';
    tools.className = 'orderTools';
    tools.innerHTML = `
      <input id="orderSearch" type="search" placeholder="חיפוש לפי הזמנה, לקוח, טלפון, מעקב או מוצר...">
      <select id="orderPaymentFilter"><option value="all">כל התשלומים</option><option value="unpaid">לא שולם</option><option value="pending">ממתין</option><option value="paid">שולם</option><option value="failed">נכשל</option><option value="refunded">הוחזר</option></select>
      <select id="orderStatusFilter"><option value="all">כל הסטטוסים</option><option value="draft">טיוטה</option><option value="payment_pending">ממתין לתשלום</option><option value="paid">שולם</option><option value="processing">בטיפול</option><option value="ordered">הוזמן</option><option value="shipped">נשלח</option><option value="completed">הושלם</option><option value="cancelled">בוטל</option><option value="error">שגיאה</option></select>
      <button id="exportOrders" class="btn small dark" type="button">ייצוא CSV</button>
      <div id="orderToolsInfo" class="orderToolsInfo"></div>`;
    toolbar.insertAdjacentElement('afterend', tools);
    tools.querySelector('#orderSearch').addEventListener('input', (e) => { searchValue = e.target.value; decorateOrderCards(); });
    tools.querySelector('#orderPaymentFilter').addEventListener('change', (e) => { paymentFilter = e.target.value; decorateOrderCards(); });
    tools.querySelector('#orderStatusFilter').addEventListener('change', (e) => { statusFilter = e.target.value; decorateOrderCards(); });
    tools.querySelector('#exportOrders').addEventListener('click', exportOrders);
  }

  const originalRenderOrders = renderOrders;
  renderOrders = function enhancedRenderOrders() {
    originalRenderOrders();
    ensureTools();
    decorateOrderCards();
  };

  ensureTopLinks();
  ensureProductTools();
  ensureTools();
  decorateOrderCards();
})();
