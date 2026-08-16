(async function loadManagedCatalog() {
  try {
    const response = await fetch('/api/products', {
      headers: { accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) return;

    const data = await response.json();
    if (!data || data.ok !== true || !Array.isArray(data.products) || !data.products.length) return;

    if (typeof products === 'undefined' || !Array.isArray(products)) return;
    const visibleProducts = data.products.filter((product) => product.available !== false);
    products.splice(0, products.length, ...visibleProducts);
    const store = data.store || {};

    const style = document.createElement('style');
    style.textContent = `
      .ahShippingLine{font-size:13px;font-weight:850;color:#344454;margin:2px 0 8px}.ahShippingLine.pending{color:#8b6500}
      .ahSalesNotice{max-width:1180px;margin:10px auto 0;padding:10px 14px;background:#fff8d8;border:1px solid #efd36d;border-radius:11px;font-size:13px;font-weight:850;color:#6e5200;text-align:center}
      .ahWaFloat{position:fixed;left:18px;bottom:18px;z-index:145;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;background:#25D366;color:#073b1a;padding:12px 16px;font-weight:950;box-shadow:0 10px 28px #0003;text-decoration:none}
      .ahWaFloat svg{width:24px;height:24px;display:block;flex:0 0 auto}.ahWaProduct{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px;text-align:center;border:1px solid #20b858;border-radius:10px;padding:11px 13px;font-weight:900;color:#126832;background:#effdf4;text-decoration:none}.ahWaProduct svg{width:20px;height:20px;flex:0 0 auto}
      .ahTrackFooter{color:#fff;font-weight:850;text-decoration:underline;text-underline-offset:3px}
      .ahCardActions{position:absolute;top:9px;left:9px;z-index:4;display:flex;gap:6px}.ahMiniBtn{width:35px;height:35px;border:1px solid #d8dde2;border-radius:999px;background:#fffffff2;box-shadow:0 3px 12px #0002;font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center}.ahMiniBtn.saved{background:#fff1f1;border-color:#f1b8bd}
      .ahModalActions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.ahActionBtn{border:1px solid #d7dde3;border-radius:10px;background:#fff;padding:11px 12px;font-weight:900;cursor:pointer}.ahActionBtn.saved{background:#fff1f1;border-color:#f1b8bd;color:#9d1e2a}
      #modalContent .add:disabled{opacity:.58;cursor:not-allowed}
      @media(max-width:620px){.ahWaFloat{left:10px;bottom:10px;padding:11px 13px}.ahWaFloat b{display:none}.ahSalesNotice{margin:8px 10px 0}}
    `;
    document.head.appendChild(style);

    function whatsappIconSvg() {
      return '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#ffffff" opacity=".96"/><path fill="#25D366" d="M23.7 20.1c-.4 1.2-2.1 2.2-3.3 2.4-.9.2-2 .3-5.7-1.3-4.8-2.1-7.9-7-8.1-7.3-1.5-2.2-1.5-4.2-.7-5.3.6-.9 1.5-1.3 2.3-1.3h.6c.5 0 .8.1 1.1.8.4.9 1.3 3.1 1.4 3.3.1.2.2.5 0 .8-.1.3-.2.4-.5.7-.2.3-.5.6-.7.8-.2.2-.4.5-.2.9.2.4 1 1.7 2.2 2.7 1.5 1.4 2.8 1.8 3.2 2 .4.2.7.2 1-.1.3-.4 1.2-1.4 1.5-1.9.3-.4.6-.4 1-.3.4.1 2.7 1.3 3.1 1.5.5.2.8.3.9.5.1.2.1.9-.1 1.6Z"/><path fill="#25D366" d="M7.6 25.2 9 21.1a10.8 10.8 0 1 1 4 3.7l-5.4.4Zm5.6-2.7.7.4a8.5 8.5 0 1 0-2.7-2.5l.4.7-.8 2.1 2.4-.7Z"/></svg>';
    }

    function shippingText(product) {
      if (product.purchaseReady !== true) {
        if (product.shippingAvailable === false) return 'אין אפשרות משלוח כרגע';
        return 'זמינות ומשלוח בבדיקה';
      }
      return 'משלוח יחושב לפי הכתובת';
    }

    function normalizeWhatsApp(value) {
      let digits = String(value || '').replace(/\D/g, '');
      if (!digits) return '';
      if (digits.startsWith('0')) digits = '972' + digits.slice(1);
      return digits;
    }

    const whatsappNumber = store.whatsappEnabled ? normalizeWhatsApp(store.whatsappNumber) : '';
    const defaultWhatsappMessage = String(store.whatsappMessage || 'היי, אשמח לעזרה לגבי מוצר או הזמנה באתר אלוף הכלים.').trim();

    function whatsappUrl(extra) {
      if (!whatsappNumber) return null;
      const text = [defaultWhatsappMessage, extra].filter(Boolean).join('\n');
      return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`;
    }

    function loadFavorites() {
      try {
        const raw = JSON.parse(localStorage.getItem('alufFavorites') || '[]');
        return new Set(Array.isArray(raw) ? raw.map(String) : []);
      } catch {
        return new Set();
      }
    }

    const favorites = loadFavorites();
    function saveFavorites() { localStorage.setItem('alufFavorites', JSON.stringify([...favorites])); }
    function toggleFavorite(id) {
      id = String(id);
      if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
      saveFavorites();
      decorateProductCards(document.querySelector('.cat.active')?.dataset?.filter || 'all');
      return favorites.has(id);
    }
    function productUrl(product) {
      const url = new URL(window.location.origin + '/');
      url.searchParams.set('product', product.id);
      return url.toString();
    }
    async function shareProduct(product) {
      const url = productUrl(product);
      const text = `${product.name} — אלוף הכלים`;
      if (navigator.share) {
        try { await navigator.share({ title: product.name, text, url }); return; } catch {}
      }
      try {
        await navigator.clipboard.writeText(url);
        alert('הקישור למוצר הועתק');
      } catch {
        window.prompt('העתק את הקישור למוצר:', url);
      }
    }

    function productFor(id) {
      return products.find((p) => String(p.id) === String(id)) || null;
    }

    function maxQtyFor(id) {
      const product = productFor(id);
      const value = Number(product?.maxQty || 20);
      return Number.isInteger(value) ? Math.max(1, Math.min(20, value)) : 20;
    }

    function blockedPurchaseMessage(product) {
      if (store.salesEnabled !== true) return 'המכירות ייפתחו בקרוב';
      if (!product || product.purchaseReady !== true) return 'המוצר עדיין בבדיקת זמינות ולא ניתן להזמין אותו כרגע';
      return '';
    }

    if (store.salesEnabled !== true && !document.getElementById('ahSalesNotice')) {
      const notice = document.createElement('div');
      notice.id = 'ahSalesNotice';
      notice.className = 'ahSalesNotice';
      notice.textContent = 'החנות פתוחה לצפייה. המכירות ייפתחו לאחר השלמת בדיקות הזמינות והתשלום.';
      const firstMain = document.querySelector('main') || document.querySelector('.wrap') || document.body.firstElementChild;
      if (firstMain?.parentNode) firstMain.parentNode.insertBefore(notice, firstMain);
      else document.body.prepend(notice);
    }

    if (whatsappNumber && !document.getElementById('ahWaFloat')) {
      const link = document.createElement('a');
      link.id = 'ahWaFloat';
      link.className = 'ahWaFloat';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.href = whatsappUrl('');
      link.innerHTML = whatsappIconSvg() + '<b>WhatsApp</b>';
      link.setAttribute('aria-label', 'צור קשר ב-WhatsApp');
      document.body.appendChild(link);
    }

    const foot = document.querySelector('.foot');
    if (foot && !document.getElementById('ahTrackFooter')) {
      const link = document.createElement('a');
      link.id = 'ahTrackFooter';
      link.className = 'ahTrackFooter';
      link.href = '/track';
      link.textContent = 'מעקב הזמנה';
      foot.appendChild(link);
    }

    function decorateProductCards(filter = 'all') {
      const visible = products.filter((p) => filter === 'all' || (Array.isArray(p.cat) && p.cat.includes(filter)));
      const cards = Array.from(document.querySelectorAll('#productGrid .product'));
      cards.forEach((card, index) => {
        const product = visible[index];
        if (!product) return;
        card.style.position = 'relative';
        const priceRow = card.querySelector('.priceRow');
        if (priceRow) {
          let line = card.querySelector('.ahShippingLine');
          if (!line) {
            line = document.createElement('div');
            line.className = 'ahShippingLine';
            priceRow.parentNode.insertBefore(line, priceRow);
          }
          line.classList.toggle('pending', product.purchaseReady !== true);
          line.textContent = '🚚 ' + shippingText(product);
        }

        let actions = card.querySelector('.ahCardActions');
        if (!actions) {
          actions = document.createElement('div');
          actions.className = 'ahCardActions';
          card.appendChild(actions);
        }
        actions.innerHTML = '';
        const fav = document.createElement('button');
        fav.type = 'button';
        fav.className = 'ahMiniBtn' + (favorites.has(String(product.id)) ? ' saved' : '');
        fav.textContent = favorites.has(String(product.id)) ? '♥' : '♡';
        fav.title = favorites.has(String(product.id)) ? 'הסר ממועדפים' : 'שמור למועדפים';
        fav.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(product.id); });
        const share = document.createElement('button');
        share.type = 'button';
        share.className = 'ahMiniBtn';
        share.textContent = '↗';
        share.title = 'שתף מוצר';
        share.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); shareProduct(product); });
        actions.append(fav, share);
      });
    }

    if (!window.__ahShippingRenderPatched && typeof window.renderProducts === 'function') {
      const originalRenderProducts = window.renderProducts;
      window.renderProducts = function patchedRenderProducts(filter = 'all') {
        originalRenderProducts(filter);
        decorateProductCards(filter);
      };
      window.__ahShippingRenderPatched = true;
    }

    if (!window.__ahShippingModalPatched && typeof window.openProduct === 'function') {
      const originalOpenProduct = window.openProduct;
      window.openProduct = function patchedOpenProduct(id) {
        originalOpenProduct(id);
        const product = productFor(id);
        if (!product) return;
        const modalInfo = document.querySelector('#modalContent .modalInfo');
        const priceRow = modalInfo?.querySelector('.priceRow');
        if (!modalInfo || !priceRow) return;
        const line = document.createElement('div');
        line.className = 'ahShippingLine' + (product.purchaseReady !== true ? ' pending' : '');
        line.textContent = '🚚 ' + shippingText(product);
        priceRow.parentNode.insertBefore(line, priceRow);

        const addButton = modalInfo.querySelector('.add');
        const blockedMessage = blockedPurchaseMessage(product);
        if (addButton && blockedMessage) {
          addButton.disabled = true;
          addButton.textContent = blockedMessage;
          addButton.title = blockedMessage;
        }

        if (whatsappNumber) {
          const existing = modalInfo.querySelector('.ahWaProduct');
          if (existing) existing.remove();
          const wa = document.createElement('a');
          wa.className = 'ahWaProduct';
          wa.target = '_blank';
          wa.rel = 'noopener noreferrer';
          wa.href = whatsappUrl(`יש לי שאלה לגבי המוצר: ${product.name}`);
          wa.innerHTML = whatsappIconSvg() + '<span>שאלה על המוצר ב-WhatsApp</span>';
          if (addButton) addButton.insertAdjacentElement('afterend', wa);
          else modalInfo.appendChild(wa);
        }

        const oldActions = modalInfo.querySelector('.ahModalActions');
        if (oldActions) oldActions.remove();
        const actions = document.createElement('div');
        actions.className = 'ahModalActions';
        const fav = document.createElement('button');
        fav.type = 'button';
        fav.className = 'ahActionBtn' + (favorites.has(String(product.id)) ? ' saved' : '');
        fav.textContent = favorites.has(String(product.id)) ? '♥ שמור במועדפים' : '♡ שמור במועדפים';
        fav.addEventListener('click', () => {
          const saved = toggleFavorite(product.id);
          fav.classList.toggle('saved', saved);
          fav.textContent = saved ? '♥ שמור במועדפים' : '♡ שמור במועדפים';
        });
        const share = document.createElement('button');
        share.type = 'button';
        share.className = 'ahActionBtn';
        share.textContent = '↗ שתף מוצר';
        share.addEventListener('click', () => shareProduct(product));
        actions.append(fav, share);
        modalInfo.appendChild(actions);
      };
      window.__ahShippingModalPatched = true;
    }

    window.alufStoreContact = {
      whatsappNumber,
      whatsappUrl,
      supportEmail: store.supportEmail || null,
      supportHours: store.supportHours || null
    };
    window.alufStoreState = {
      salesEnabled: store.salesEnabled === true,
      productReady: (id) => productFor(id)?.purchaseReady === true
    };

    if (typeof cart !== 'undefined' && cart && typeof cart === 'object') {
      let changed = false;
      for (const id of Object.keys(cart)) {
        const product = productFor(id);
        if (!product || product.purchaseReady !== true) {
          delete cart[id];
          changed = true;
          continue;
        }
        const maxQty = maxQtyFor(id);
        const current = Number(cart[id] || 0);
        if (current > maxQty) {
          cart[id] = maxQty;
          changed = true;
        }
      }
      if (changed) localStorage.setItem('alufCart', JSON.stringify(cart));
    }

    if (!window.__ahQtyPatched && typeof window.addToCart === 'function' && typeof window.changeQty === 'function') {
      const originalAddToCart = window.addToCart;
      const originalChangeQty = window.changeQty;
      window.addToCart = function limitedAddToCart(id) {
        const product = productFor(id);
        const blockedMessage = blockedPurchaseMessage(product);
        if (blockedMessage) {
          if (typeof showToast === 'function') showToast(blockedMessage);
          return;
        }
        const maxQty = maxQtyFor(id);
        const current = Number((typeof cart !== 'undefined' && cart?.[id]) || 0);
        if (current >= maxQty) {
          if (typeof showToast === 'function') showToast(`ניתן להזמין עד ${maxQty} יחידות מהמוצר הזה`);
          return;
        }
        originalAddToCart(id);
      };
      window.changeQty = function limitedChangeQty(id, delta) {
        const product = productFor(id);
        if (Number(delta) > 0) {
          const blockedMessage = blockedPurchaseMessage(product);
          if (blockedMessage) {
            if (typeof showToast === 'function') showToast(blockedMessage);
            return;
          }
        }
        const maxQty = maxQtyFor(id);
        const current = Number((typeof cart !== 'undefined' && cart?.[id]) || 0);
        if (Number(delta) > 0 && current >= maxQty) {
          if (typeof showToast === 'function') showToast(`ניתן להזמין עד ${maxQty} יחידות מהמוצר הזה`);
          return;
        }
        originalChangeQty(id, delta);
      };
      window.__ahQtyPatched = true;
    }

    const activeCategory = document.querySelector('.cat.active');
    const filter = activeCategory && activeCategory.dataset ? (activeCategory.dataset.filter || 'all') : 'all';
    if (typeof renderProducts === 'function') renderProducts(filter);
    if (typeof renderCart === 'function') renderCart();

    const requestedProduct = new URLSearchParams(window.location.search).get('product');
    if (requestedProduct && products.some((p) => String(p.id) === String(requestedProduct)) && typeof window.openProduct === 'function') {
      setTimeout(() => window.openProduct(requestedProduct), 80);
    }
  } catch (error) {
    console.warn('Managed catalog unavailable; using storefront fallback.');
  }
})();
