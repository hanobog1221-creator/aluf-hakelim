(() => {
  const style = document.createElement('style');
  style.textContent = `
    .orderTools{display:grid;grid-template-columns:minmax(220px,1fr) 180px 180px auto;gap:8px;margin:0 0 14px}
    .orderTools input,.orderTools select,.productTools input,.productTools select{height:42px;border:1px solid #cfd5dc;border-radius:10px;background:#fff;padding:0 11px;font:inherit}
    .orderTools .btn,.productTools .btn{height:42px;padding:0 13px}.orderToolsInfo,.productToolsInfo{grid-column:1/-1;color:#6f7b87;font-size:12px}
    .orderQuickActions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.orderQuickActions button,.orderQuickActions a{border:1px solid #d7dde3;background:#fff;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:900;text-decoration:none;color:#171717;cursor:pointer;display:inline-flex;align-items:center;gap:6px}.orderQuickActions .waCustomer{background:#effdf4;border-color:#a9e6be;color:#126832}.orderQuickActions svg{width:16px;height:16px;flex:0 0 auto}
    .orderNotes{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}.orderNotes textarea{width:100%;min-height:72px;border:1px solid #cfd5dc;border-radius:10px;padding:10px;font:inherit;resize:vertical}.orderNotes label{font-size:12px;font-weight:900;display:block;margin-bottom:5px}.orderNotes small{display:block;color:#6f7b87;margin-top:4px;line-height:1.4}
    .productToolbarActions{display:flex;gap:7px;flex-wrap:wrap}.ahQtyField{margin-top:9px;max-width:230px}.ahQtyField label{font-size:12px;font-weight:900;display:block;margin-bottom:5px}.ahQtyField input{width:100%;border:1px solid #cfd5dc;border-radius:10px;padding:10px;background:#fff}
    .productTools{display:grid;grid-template-columns:minmax(220px,1fr) 210px auto;gap:8px;margin:0 0 14px}
    .ahOpsSummary{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:-4px 0 14px}.ahOpsStat{background:#fff;border:1px solid #dfe4e9;border-radius:13px;padding:12px}.ahOpsStat b{display:block;font-size:22px}.ahOpsStat small{color:#6f7b87}
    .ahFinance{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0 0 12px}.ahFinanceBox{border:1px solid #e2e6ea;background:#f8fafb;border-radius:11px;padding:10px}.ahFinanceBox b{display:block;font-size:17px;margin-top:3px}.ahFinanceBox small{color:#68717c}.ahFinanceBox.profit.ok{background:#eef9f2;border-color:#c6e9d3}.ahFinanceBox.profit.bad{background:#fff0f0;border-color:#ffc8cb}.ahFinanceBox.unknown b{font-size:13px;color:#68717c}
    .ahProductStatus{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 11px}.ahState{border-radius:999px;padding:5px 8px;font-size:11px;font-weight:900;background:#eef1f4;color:#54606b}.ahState.ok{background:#e5f7ed;color:#197342}.ahState.warn{background:#fff4cf;color:#8b6500}.ahState.bad{background:#ffe8e9;color:#a51e28}
    .ahBlockers{background:#fff8d8;border:1px solid #efd36d;border-radius:10px;padding:9px 11px;margin:0 0 11px;font-size:12px;line-height:1.55}.ahBlockers strong{display:block;margin-bottom:3px}.ahProductActions{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 12px}.ahProductActions button,.ahProductActions a{border:1px solid #d7dde3;background:#fff;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:900;text-decoration:none;color:#171717;cursor:pointer}.ahProductActions .sync{background:#111923;color:#fff;border-color:#111923}.ahProductActionMsg{font-size:12px;font-weight:850;color:#197342;align-self:center}
    .ahResolveRow{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:6px}.ahResolveRow button{border:1px solid #d7dde3;background:#fff;border-radius:8px;padding:7px 9px;font-size:12px;font-weight:900;cursor:pointer}.ahResolveRow span{font-size:12px;color:#68717c}
    @media(max-width:950px){.ahFinance,.ahOpsSummary{grid-template-columns:1fr 1fr}}
    @media(max-width:850px){.orderTools,.productTools{grid-template-columns:1fr 1fr}.orderTools input,.productTools input{grid-column:1/-1}.orderTools .btn,.productTools .btn{width:100%}.orderNotes{grid-template-columns:1fr}}
    @media(max-width:520px){.orderTools,.productTools,.ahFinance,.ahOpsSummary{grid-template-columns:1fr}.orderTools input,.productTools input{grid-column:auto}}
  `;
  document.head.appendChild(style);

  let searchValue = '';
  let paymentFilter = 'all';
  let statusFilter = 'all';
  let productSearchValue = '';
  let productStatusFilter = 'all';

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function moneyMaybe(value, fallback = 'ממתין לסנכרון') {
    const n = numberOrNull(value);
    return n == null ? fallback : money(n);
  }

  function whatsappIcon() {
    return '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="15" r="11" fill="currentColor" opacity=".16"/><path fill="currentColor" d="M23.7 20.1c-.4 1.2-2.1 2.2-3.3 2.4-.9.2-2 .3-5.7-1.3-4.8-2.1-7.9-7-8.1-7.3-1.5-2.2-1.5-4.2-.7-5.3.6-.9 1.5-1.3 2.3-1.3h.6c.5 0 .8.1 1.1.8.4.9 1.3 3.1 1.4 3.3.1.2.2.5 0 .8-.1.3-.2.4-.5.7-.2.3-.5.6-.7.8-.2.2-.4.5-.2.9.2.4 1 1.7 2.2 2.7 1.5 1.4 2.8 1.8 3.2 2 .4.2.7.2 1-.1.3-.4 1.2-1.4 1.5-1.9.3-.4.6-.4 1-.3.4.1 2.7 1.3 3.1 1.5.5.2.8.3.9.5.1.2.1.9-.1 1.6Z"/></svg>';
  }

  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('0')) digits = '972' + digits.slice(1);
    return digits;
  }

  function productFinancials(product) {
    const selling = numberOrNull(product.selling_price) || 0;
    const supplierPrice = numberOrNull(product.supplier_price_ils) ?? (String(product.supplier_currency || '').toUpperCase() === 'ILS' ? numberOrNull(product.supplier_price) : null);
    const shipping = numberOrNull(product.supplier_shipping);
    const shippingKnown = product.supplier_shipping_available === true && shipping != null;
    const supplierTotal = supplierPrice != null && shippingKnown ? Number((supplierPrice + shipping).toFixed(2)) : null;
    const customerTotal = shippingKnown ? Number((selling + shipping).toFixed(2)) : null;
    const profit = supplierTotal != null && customerTotal != null ? Number((customerTotal - supplierTotal).toFixed(2)) : null;
    const margin = profit != null && customerTotal > 0 ? Number((profit / customerTotal * 100).toFixed(1)) : null;
    return { selling, supplierPrice, shipping, shippingKnown, supplierTotal, customerTotal, profit, margin };
  }

  function productBlockers(product) {
    const list = [];
    if (!product.supplier_product_id) list.push('חסר Product ID');
    if (!product.supplier_sku_id) list.push('חסר SKU מדויק');
    if (!product.fulfillment_ready) list.push('המוצר עדיין לא מאומת להזמנה אוטומטית');
    if (numberOrNull(product.supplier_price_ils) == null) list.push('עלות המוצר עדיין לא סונכרנה');
    if (product.supplier_in_stock === null || product.supplier_in_stock === undefined) list.push('מצב המלאי עדיין לא ידוע');
    if (product.supplier_shipping_available === null || product.supplier_shipping_available === undefined) list.push('עלות/זמינות המשלוח עדיין לא ידועה');
    if (product.supplier_in_stock === false) list.push('המוצר מסומן כאזל מהמלאי');
    if (product.supplier_shipping_available === false) list.push('אין אפשרות משלוח כרגע');
    if (product.supplier_sync_error) list.push('שגיאת סנכרון מוצר');
    if (product.shipping_sync_error) list.push('שגיאת בדיקת משלוח');
    return list;
  }

  function orderSearchText(order) {
    const c = order.customer || {};
    return [order.order_id,c.fullName,c.phone,c.city,c.street,order.tracking_number,order.coupon_code,...(Array.isArray(order.items) ? order.items.map((item) => item.name) : [])].filter(Boolean).join(' ').toLocaleLowerCase('he');
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

  function visibleProducts() {
    const q = productSearchValue.trim().toLocaleLowerCase('he');
    return state.products.filter((product) => {
      const text = [product.id,product.name,product.supplier_product_id,product.supplier_sku_id,product.variant_label].filter(Boolean).join(' ').toLocaleLowerCase('he');
      const matchSearch = !q || text.includes(q);
      let matchStatus = true;
      if (productStatusFilter === 'ready') matchStatus = product.fulfillment_ready === true;
      if (productStatusFilter === 'attention') matchStatus = productBlockers(product).length > 0;
      if (productStatusFilter === 'inactive') matchStatus = product.active !== true;
      if (productStatusFilter === 'cost-known') matchStatus = productFinancials(product).supplierTotal != null;
      return matchSearch && matchStatus;
    });
  }

  function csvCell(value) { return '"' + String(value ?? '').replace(/"/g, '""') + '"'; }

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
      const address = [c.street,c.houseNumber,c.apartment && ('דירה ' + c.apartment),c.city,c.postalCode].filter(Boolean).join(', ');
      lines.push([o.order_id,o.created_at || '',c.fullName || '',c.phone || '',c.city || '',address,Number(o.total || 0)+Number(o.shipping_cost || 0),o.payment_status || '',o.status || '',o.tracking_number || '',o.coupon_code || ''].map(csvCell).join(','));
    }
    downloadCsv(`aluf-hakelim-orders-${new Date().toISOString().slice(0,10)}.csv`, lines);
  }

  function exportProducts() {
    const header = ['מזהה','שם','מחיר מכירה','משלוח','מחיר ללקוח כולל משלוח','עלות מוצר','עלות כוללת משלוח','רווח משוער','מקסימום יחידות להזמנה','פעיל','Product ID','SKU ID','וריאנט','מוכן לאוטומציה'];
    const lines = [header.map(csvCell).join(',')];
    for (const p of state.products) {
      const f = productFinancials(p);
      lines.push([p.id,p.name,p.selling_price,f.shippingKnown ? f.shipping : '',f.customerTotal ?? '',f.supplierPrice ?? '',f.supplierTotal ?? '',f.profit ?? '',p.max_order_quantity || 20,p.active ? 'כן' : 'לא',p.supplier_product_id || '',p.supplier_sku_id || '',p.variant_label || '',p.fulfillment_ready ? 'כן' : 'לא'].map(csvCell).join(','));
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

  async function resolveShortUrl(url) {
    const value = String(url || '').trim();
    if (!/^https:\/\/a\.aliexpress\.com\//i.test(value)) throw new Error('not_short_url');
    const response = await fetch('/api/aliexpress/resolve?url=' + encodeURIComponent(value), { headers: { accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.productId) throw new Error(data.error || 'resolve_failed');
    return data;
  }

  async function syncProduct(product, button, messageBox) {
    if (!product.supplier_product_id) { messageBox.textContent = 'חסר Product ID'; return; }
    button.disabled = true;
    messageBox.textContent = 'מסנכרן...';
    try {
      const response = await fetch('/api/aliexpress/product-v2?storeProductId=' + encodeURIComponent(product.id), { headers: { accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error('unauthorized');
      if (!data.ok) {
        messageBox.textContent = data.waitingForAliExpressPermission ? 'ממתין לפתיחת הרשאת הסנכרון' : 'הסנכרון לא הושלם';
        return;
      }
      const refreshed = await api('/api/admin/products');
      state.products = refreshed.products || [];
      renderSummary();
      renderProducts();
      messageBox.textContent = 'סונכרן ✓';
    } catch {
      messageBox.textContent = 'לא הצלחנו לסנכרן כרגע';
    } finally {
      button.disabled = false;
    }
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
        notes.innerHTML = `<div><label>הערה פנימית — רק לך</label><textarea data-ok="admin_note" maxlength="2000" placeholder="לדוגמה: לבדוק כתובת לפני טיפול">${esc(order.admin_note || '')}</textarea><small>לא מוצג ללקוח.</small></div><div><label>עדכון שיוצג ללקוח</label><textarea data-ok="customer_note" maxlength="800" placeholder="לדוגמה: ההזמנה צפויה לצאת למשלוח בקרוב">${esc(order.customer_note || '')}</textarea><small>יופיע בעמוד מעקב ההזמנה.</small></div>`;
        body?.appendChild(notes);
      }

      if (!card.querySelector('.orderQuickActions')) {
        const c = order.customer || {};
        const address = [c.street,c.houseNumber,c.apartment && ('דירה ' + c.apartment),c.city,c.postalCode].filter(Boolean).join(', ');
        const phone = normalizePhone(c.phone);
        const actions = document.createElement('div');
        actions.className = 'orderQuickActions';
        if (phone) {
          const wa = document.createElement('a');
          wa.className = 'waCustomer';
          wa.target = '_blank';
          wa.rel = 'noopener noreferrer';
          wa.href = `https://wa.me/${phone}?text=${encodeURIComponent(statusMessage(order))}`;
          wa.innerHTML = whatsappIcon() + '<span>WhatsApp ללקוח</span>';
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

  function decorateProductCards() {
    const visibleIds = new Set(visibleProducts().map((p) => String(p.id)));
    const cards = Array.from(document.querySelectorAll('#productsList [data-product]'));
    for (const card of cards) {
      const id = String(card.dataset.product || '');
      const product = state.products.find((p) => String(p.id) === id);
      card.style.display = visibleIds.has(id) ? '' : 'none';
      if (!product) continue;
      const body = card.querySelector('.cardBody');
      const row = body?.querySelector('.row');
      if (!body || !row) continue;

      if (!card.querySelector('[data-k="max_order_quantity"]')) {
        const field = document.createElement('div');
        field.className = 'ahQtyField';
        field.innerHTML = `<label>מקסימום יחידות להזמנה אחת</label><input data-k="max_order_quantity" type="number" min="1" max="100" step="1" value="${Number(product.max_order_quantity || 20)}">`;
        body.insertBefore(field, row);
      }

      if (!card.querySelector('.ahFinance')) {
        const f = productFinancials(product);
        const finance = document.createElement('div');
        finance.className = 'ahFinance';
        const costText = product.supplier_shipping_available === false ? 'משלוח לא זמין' : moneyMaybe(f.supplierTotal);
        const sellText = product.supplier_shipping_available === false ? 'משלוח לא זמין' : moneyMaybe(f.customerTotal);
        const profitClass = f.profit == null ? 'unknown' : (f.profit >= 0 ? 'ok' : 'bad');
        finance.innerHTML = `<div class="ahFinanceBox ${f.supplierTotal == null ? 'unknown' : ''}"><small>העלות שלך כולל משלוח</small><b>${esc(costText)}</b></div><div class="ahFinanceBox ${f.customerTotal == null ? 'unknown' : ''}"><small>המחיר ללקוח כולל משלוח</small><b>${esc(sellText)}</b></div><div class="ahFinanceBox profit ${profitClass}"><small>רווח משוער לפני עמלות/מס</small><b>${f.profit == null ? 'ממתין לנתוני עלות' : money(f.profit)}</b></div><div class="ahFinanceBox"><small>משלוח</small><b>${product.supplier_shipping_available === false ? 'לא זמין' : (f.shippingKnown ? (f.shipping <= 0 ? 'חינם' : money(f.shipping)) : 'ממתין לסנכרון')}</b></div>`;
        body.insertBefore(finance, body.firstChild);
      }

      if (!card.querySelector('.ahProductStatus')) {
        const statuses = document.createElement('div');
        statuses.className = 'ahProductStatus';
        const syncText = product.last_sync_at ? `סנכרון: ${fmtDate(product.last_sync_at)}` : 'טרם סונכרן';
        statuses.innerHTML = `<span class="ahState ${product.active ? 'ok' : 'bad'}">${product.active ? 'פעיל' : 'כבוי'}</span><span class="ahState ${product.fulfillment_ready ? 'ok' : 'warn'}">${product.fulfillment_ready ? 'מוכן לאוטומציה' : 'לא מוכן לאוטומציה'}</span><span class="ahState ${product.supplier_in_stock === false ? 'bad' : product.supplier_in_stock === true ? 'ok' : 'warn'}">${product.supplier_in_stock === false ? 'אזל מהמלאי' : product.supplier_in_stock === true ? 'במלאי' : 'מלאי לא ידוע'}</span><span class="ahState warn">${esc(syncText)}</span>`;
        const finance = body.querySelector('.ahFinance');
        finance?.insertAdjacentElement('afterend', statuses);
      }

      if (!card.querySelector('.ahBlockers')) {
        const blockers = productBlockers(product);
        if (blockers.length) {
          const box = document.createElement('div');
          box.className = 'ahBlockers';
          box.innerHTML = `<strong>מה עוד חסר במוצר הזה:</strong>${blockers.map((x) => `• ${esc(x)}`).join('<br>')}`;
          const status = body.querySelector('.ahProductStatus');
          status?.insertAdjacentElement('afterend', box);
        }
      }

      if (!card.querySelector('.ahProductActions')) {
        const actions = document.createElement('div');
        actions.className = 'ahProductActions';
        const sync = document.createElement('button');
        sync.type = 'button';
        sync.className = 'sync';
        sync.textContent = 'סנכרן נתונים עכשיו';
        const msg = document.createElement('span');
        msg.className = 'ahProductActionMsg';
        sync.addEventListener('click', () => syncProduct(product, sync, msg));
        actions.appendChild(sync);

        const storeLink = document.createElement('a');
        storeLink.href = '/?product=' + encodeURIComponent(product.id);
        storeLink.target = '_blank';
        storeLink.rel = 'noopener noreferrer';
        storeLink.textContent = 'פתח בחנות';
        actions.appendChild(storeLink);

        if (product.supplier_url) {
          const supplierLink = document.createElement('a');
          supplierLink.href = product.supplier_url;
          supplierLink.target = '_blank';
          supplierLink.rel = 'noopener noreferrer';
          supplierLink.textContent = 'פתח קישור ספק';
          actions.appendChild(supplierLink);
        }

        const supplierUrlInput = card.querySelector('[data-k="supplier_url"]');
        const productIdInput = card.querySelector('[data-k="supplier_product_id"]');
        if (supplierUrlInput && productIdInput) {
          const resolve = document.createElement('button');
          resolve.type = 'button';
          resolve.textContent = 'חלץ Product ID מהקישור';
          resolve.addEventListener('click', async () => {
            resolve.disabled = true;
            msg.textContent = 'בודק קישור...';
            try {
              const data = await resolveShortUrl(supplierUrlInput.value);
              productIdInput.value = data.productId;
              msg.textContent = `נמצא Product ID: ${data.productId} — לחץ שמור מוצר`;
            } catch {
              msg.textContent = 'הקישור אינו קישור קצר תקין או שלא ניתן לחלץ ממנו מזהה';
            } finally {
              resolve.disabled = false;
            }
          });
          actions.appendChild(resolve);
        }
        actions.appendChild(msg);
        const finance = body.querySelector('.ahFinance');
        finance?.insertAdjacentElement('afterend', actions);
      }
    }
    const info = document.getElementById('productToolsInfo');
    if (info) info.textContent = `${visibleIds.size} מתוך ${state.products.length} מוצרים`;
    updateOpsSummary();
  }

  function updateOpsSummary() {
    const box = document.getElementById('ahOpsSummary');
    if (!box) return;
    const active = state.products.filter((p) => p.active === true);
    const ready = active.filter((p) => p.fulfillment_ready === true).length;
    const costKnown = active.filter((p) => productFinancials(p).supplierTotal != null).length;
    const missingSku = active.filter((p) => !p.supplier_sku_id).length;
    const syncProblems = active.filter((p) => p.supplier_sync_error || p.shipping_sync_error || p.supplier_in_stock === false || p.supplier_shipping_available === false).length;
    box.innerHTML = `<div class="ahOpsStat"><b>${ready}/${active.length}</b><small>מוצרים מוכנים לאוטומציה</small></div><div class="ahOpsStat"><b>${costKnown}/${active.length}</b><small>עלות כולל משלוח ידועה</small></div><div class="ahOpsStat"><b>${missingSku}</b><small>מוצרים שחסר להם SKU</small></div><div class="ahOpsStat"><b>${syncProblems}</b><small>בעיות מלאי/משלוח/סנכרון</small></div>`;
  }

  function ensureOpsSummary() {
    if (document.getElementById('ahOpsSummary')) return;
    const summary = document.querySelector('.summary');
    if (!summary) return;
    const box = document.createElement('div');
    box.id = 'ahOpsSummary';
    box.className = 'ahOpsSummary';
    summary.insertAdjacentElement('afterend', box);
    updateOpsSummary();
  }

  function ensureTopLinks() {
    const topActions = document.querySelector('.topActions');
    if (!topActions) return;
    const links = [['accountingLink','/accounting','חשבונות'],['expensesLink','/expenses','הוצאות'],['paymentSettingsLink','/payment-settings','ספקי תשלום'],['launchChecklistLink','/launch-checklist','מוכנות להשקה']];
    for (const [id, href, label] of links) {
      if (document.getElementById(id)) continue;
      const link = document.createElement('a');
      link.id = id;
      link.href = href;
      link.textContent = label;
      topActions.insertBefore(link, topActions.firstChild);
    }
  }

  function ensureProductTools() {
    const productsTab = document.getElementById('productsTab');
    const toolbar = productsTab?.querySelector('.toolbar');
    const newButton = document.getElementById('newProductBtn');
    if (!productsTab || !toolbar || !newButton) return;

    if (!document.getElementById('exportProducts')) {
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

    if (!document.getElementById('productTools')) {
      const tools = document.createElement('div');
      tools.id = 'productTools';
      tools.className = 'productTools';
      tools.innerHTML = `<input id="productSearch" type="search" placeholder="חיפוש לפי שם, מזהה, Product ID, SKU או וריאנט..."><select id="productStatusFilter"><option value="all">כל המוצרים</option><option value="attention">דורשים טיפול</option><option value="ready">מוכנים לאוטומציה</option><option value="cost-known">עלות מלאה ידועה</option><option value="inactive">כבויים</option></select><button id="clearProductFilters" class="btn small dark" type="button">נקה סינון</button><div id="productToolsInfo" class="productToolsInfo"></div>`;
      toolbar.insertAdjacentElement('afterend', tools);
      tools.querySelector('#productSearch').addEventListener('input', (e) => { productSearchValue = e.target.value; decorateProductCards(); });
      tools.querySelector('#productStatusFilter').addEventListener('change', (e) => { productStatusFilter = e.target.value; decorateProductCards(); });
      tools.querySelector('#clearProductFilters').addEventListener('click', () => { productSearchValue = ''; productStatusFilter = 'all'; tools.querySelector('#productSearch').value = ''; tools.querySelector('#productStatusFilter').value = 'all'; decorateProductCards(); });
    }
  }

  function ensureNewProductResolver() {
    const input = document.getElementById('npSupplierUrl');
    const target = document.getElementById('npProductId');
    if (!input || !target || document.getElementById('npResolveRow')) return;
    const row = document.createElement('div');
    row.id = 'npResolveRow';
    row.className = 'ahResolveRow';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'חלץ Product ID מקישור קצר';
    const msg = document.createElement('span');
    button.addEventListener('click', async () => {
      button.disabled = true;
      msg.textContent = 'בודק...';
      try {
        const data = await resolveShortUrl(input.value);
        target.value = data.productId;
        msg.textContent = `נמצא: ${data.productId}`;
      } catch {
        msg.textContent = 'לא הצלחנו לחלץ מזהה מהקישור';
      } finally {
        button.disabled = false;
      }
    });
    row.append(button, msg);
    input.insertAdjacentElement('afterend', row);
  }

  function ensureOrderTools() {
    const ordersTab = document.getElementById('ordersTab');
    const toolbar = ordersTab?.querySelector('.toolbar');
    if (!ordersTab || !toolbar || document.getElementById('orderTools')) return;
    const tools = document.createElement('div');
    tools.id = 'orderTools';
    tools.className = 'orderTools';
    tools.innerHTML = `<input id="orderSearch" type="search" placeholder="חיפוש לפי הזמנה, לקוח, טלפון, מעקב או מוצר..."><select id="orderPaymentFilter"><option value="all">כל התשלומים</option><option value="unpaid">לא שולם</option><option value="pending">ממתין</option><option value="paid">שולם</option><option value="failed">נכשל</option><option value="refunded">הוחזר</option></select><select id="orderStatusFilter"><option value="all">כל הסטטוסים</option><option value="draft">טיוטה</option><option value="payment_pending">ממתין לתשלום</option><option value="paid">שולם</option><option value="processing">בטיפול</option><option value="ordered">הוזמן</option><option value="shipped">נשלח</option><option value="completed">הושלם</option><option value="cancelled">בוטל</option><option value="error">שגיאה</option></select><button id="exportOrders" class="btn small dark" type="button">ייצוא CSV</button><div id="orderToolsInfo" class="orderToolsInfo"></div>`;
    toolbar.insertAdjacentElement('afterend', tools);
    tools.querySelector('#orderSearch').addEventListener('input', (e) => { searchValue = e.target.value; decorateOrderCards(); });
    tools.querySelector('#orderPaymentFilter').addEventListener('change', (e) => { paymentFilter = e.target.value; decorateOrderCards(); });
    tools.querySelector('#orderStatusFilter').addEventListener('change', (e) => { statusFilter = e.target.value; decorateOrderCards(); });
    tools.querySelector('#exportOrders').addEventListener('click', exportOrders);
  }

  const originalRenderProducts = renderProducts;
  renderProducts = function enhancedRenderProducts() {
    originalRenderProducts();
    ensureProductTools();
    ensureNewProductResolver();
    decorateProductCards();
  };

  const originalRenderOrders = renderOrders;
  renderOrders = function enhancedRenderOrders() {
    originalRenderOrders();
    ensureOrderTools();
    decorateOrderCards();
  };

  ensureTopLinks();
  ensureOpsSummary();
  ensureProductTools();
  ensureNewProductResolver();
  decorateProductCards();
  ensureOrderTools();
  decorateOrderCards();
})();
