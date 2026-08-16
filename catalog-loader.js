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
    products.splice(0, products.length, ...data.products);

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
