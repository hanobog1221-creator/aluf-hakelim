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

    const style = document.createElement('style');
    style.textContent = '.ahShippingLine{font-size:13px;font-weight:850;color:#344454;margin:2px 0 8px}.ahShippingLine.free{color:#208b4b}';
    document.head.appendChild(style);

    function shippingText(product) {
      if (product.shippingAvailable === false) return 'אין משלוח לישראל';
      const amount = product.shipping == null ? null : Number(product.shipping);
      if (Number.isFinite(amount) && amount <= 0) return 'משלוח חינם';
      if (Number.isFinite(amount) && amount > 0) return `משלוח ${typeof money === 'function' ? money(amount) : '₪' + amount.toFixed(2)}`;
      return 'משלוח יחושב לפי הכתובת';
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
      };
      window.__ahShippingModalPatched = true;
    }

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
