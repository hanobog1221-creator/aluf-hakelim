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
    const sellableProducts = data.products.filter((product) => product.available !== false);
    products.splice(0, products.length, ...sellableProducts);
    const store = data.store || {};

    const style = document.createElement('style');
    style.textContent = `
      .ahShippingLine{font-size:13px;font-weight:850;color:#344454;margin:2px 0 8px}.ahShippingLine.free{color:#208b4b}
      .ahWaFloat{position:fixed;left:18px;bottom:18px;z-index:145;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;background:#25D366;color:#073b1a;padding:12px 16px;font-weight:950;box-shadow:0 10px 28px #0003;text-decoration:none}
      .ahWaFloat span{font-size:19px}.ahWaProduct{display:block;margin-top:10px;text-align:center;border:1px solid #20b858;border-radius:10px;padding:11px 13px;font-weight:900;color:#126832;background:#effdf4;text-decoration:none}
      .ahTrackFooter{color:#fff;font-weight:850;text-decoration:underline;text-underline-offset:3px}
      .ahCardActions{position:absolute;top:9px;left:9px;z-index:4;display:flex;gap:6px}.ahMiniBtn{width:35px;height:35px;border:1px solid #d8dde2;border-radius:999px;background:#fffffff2;box-shadow:0 3px 12px #0002;font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center}.ahMiniBtn.saved{background:#fff1f1;border-color:#f1b8bd}
      .ahModalActions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.ahActionBtn{border:1px solid #d7dde3;border-radius:10px;background:#fff;padding:11px 12px;font-weight:900;cursor:pointer}.ahActionBtn.saved{background:#fff1f1;border-color:#f1b8bd;color:#9d1e2a}
      @media(max-width:620px){.ahWaFloat{left:10px;bottom:10px;padding:11px 13px}.ahWaFloat b{display:none}}
    `;
    document.head.appendChild(style);

    function shippingText(product) {
      if (product.shippingAvailable === false) return 'אין אפשרות משלוח כרגע';
      const amount = product.shipping == null ? null : Number(product.shipping);
      if (Number.isFinite(amount) && amount <= 0) return 'משלוח חינם';
      if (Number.isFinite(amount) && amount > 0) return `משלוח ${typeof money === 'function' ? money(amount) : '₪' + amount.toFixed(2)}`;
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
    function saveFavorites() {
      localStorage.setItem('alufFavorites', JSON.stringify([...favorites]));
    }
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

    function maxQtyFor(id) {
      const product = products.find((p) => String(p.id) === String(id));
      const value = Number(product?.maxQty || 20);
      return Number.isInteger(value) ? Math.max(1, Math.min(100, value)) : 20;
    }

    if (whatsappNumber && !document.getElementById('ahWaFloat')) {
      const link = document.createElement('a');
      link.id = 'ahWaFloat';
      link.className = 'ahWaFloat';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.href = whatsappUrl('');
      link.innerHTML = '<span>💬</span><b>WhatsApp</b>';
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
          const amount = product.shipping == null ? null : Number(product.shipping);
          line.classList.toggle('free', Number.isFinite(amount) && amount <= 0);
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
        const product = products.find((p) => String(p.id) === String(id));
        if (!product) return;
        const modalInfo = document.querySelector('#modalContent .modalInfo');
        const priceRow = modalInfo?.querySelector('.priceRow');
        if (!modalInfo || !priceRow) return;
        const line = document.createElement('div');
        line.className = 'ahShippingLine';
        const amount = product.shipping == null ? null : Number(product.shipping);
        line.classList.toggle('free', Number.isFinite(amount) && amount <= 0);
        line.textContent = '🚚 ' + shippingText(product);
        priceRow.parentNode.insertBefore(line, priceRow);

        if (whatsappNumber) {
          const existing = modalInfo.querySelector('.ahWaProduct');
          if (existing) existing.remove();
          const wa = document.createElement('a');
          wa.className = 'ahWaProduct';
          wa.target = '_blank';
          wa.rel = 'noopener noreferrer';
          wa.href = whatsappUrl(`יש לי שאלה לגבי המוצר: ${product.name}`);
          wa.textContent = 'שאלה על המוצר ב-WhatsApp';
          const addButton = modalInfo.querySelector('.add');
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

    if (typeof cart !== 'undefined' && cart && typeof cart === 'object') {
      let changed = false;
      for (const id of Object.keys(cart)) {
        if (!products.some((product) => String(product.id) === String(id))) {
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
        const maxQty = maxQtyFor(id);
        const current = Number((typeof cart !== 'undefined' && cart?.[id]) || 0);
        if (current >= maxQty) {
          if (typeof showToast === 'function') showToast(`ניתן להזמין עד ${maxQty} יחידות מהמוצר הזה`);
          return;
        }
        originalAddToCart(id);
      };
      window.changeQty = function limitedChangeQty(id, delta) {
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
