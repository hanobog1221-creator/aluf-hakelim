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
      @media(max-width:620px){.ahWaFloat{left:10px;bottom:10px;padding:11px 13px}.ahWaFloat b{display:none}}
    `;
    document.head.appendChild(style);

    function shippingText(product) {
      if (product.shippingAvailable === false) return 'אין משלוח לישראל';
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
        const priceRow = card.querySelector('.priceRow');
        if (!priceRow) return;
        let line = card.querySelector('.ahShippingLine');
        if (!line) {
          line = document.createElement('div');
          line.className = 'ahShippingLine';
          priceRow.parentNode.insertBefore(line, priceRow);
        }
        const amount = product.shipping == null ? null : Number(product.shipping);
        line.classList.toggle('free', Number.isFinite(amount) && amount <= 0);
        line.textContent = '🚚 ' + shippingText(product);
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
        if (!products.some((product) => product.id === id)) {
          delete cart[id];
          changed = true;
        }
      }
      if (changed) localStorage.setItem('alufCart', JSON.stringify(cart));
    }

    const activeCategory = document.querySelector('.cat.active');
    const filter = activeCategory && activeCategory.dataset ? (activeCategory.dataset.filter || 'all') : 'all';
    if (typeof renderProducts === 'function') renderProducts(filter);
    if (typeof renderCart === 'function') renderCart();
  } catch (error) {
    console.warn('Managed catalog unavailable; using storefront fallback.');
  }
})();
