(() => {
  function boot() {
    const grid = document.getElementById('productGrid');
    if (!grid || document.getElementById('ahStoreTools')) return;

    const style = document.createElement('style');
    style.textContent = `
      .ahStoreTools{display:grid;grid-template-columns:minmax(220px,1fr) 190px auto;gap:9px;margin:0 0 16px;align-items:center}
      .ahSearchBox{position:relative}.ahSearchBox input{width:100%;height:46px;border:1px solid #d7dde3;border-radius:12px;background:#fff;padding:0 42px 0 13px;font:inherit;outline:none}.ahSearchBox input:focus{border-color:#9aa6b2;box-shadow:0 0 0 3px #1119230c}.ahSearchIcon{position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:18px;color:#697681;pointer-events:none}
      .ahStoreTools select{height:46px;border:1px solid #d7dde3;border-radius:12px;background:#fff;padding:0 11px;font:inherit;font-weight:800}
      .ahFavFilter{height:46px;border:1px solid #d7dde3;border-radius:12px;background:#fff;padding:0 14px;font-weight:900;white-space:nowrap}.ahFavFilter.on{background:#fff1f1;border-color:#efb8bc;color:#9d1e2a}
      .ahResultInfo{grid-column:1/-1;color:#68717c;font-size:13px;margin-top:-2px}.ahNoResults{display:none;background:#fff;border:1px solid #dfe4e9;border-radius:14px;padding:28px;text-align:center;color:#68717c;margin:-2px 0 24px}.ahNoResults.show{display:block}
      @media(max-width:700px){.ahStoreTools{grid-template-columns:1fr 1fr}.ahSearchBox{grid-column:1/-1}.ahFavFilter{width:100%}.ahResultInfo{grid-column:1/-1}}
    `;
    document.head.appendChild(style);

    const tools = document.createElement('div');
    tools.id = 'ahStoreTools';
    tools.className = 'ahStoreTools';
    tools.innerHTML = `
      <div class="ahSearchBox"><span class="ahSearchIcon">⌕</span><input id="ahProductSearch" type="search" placeholder="חיפוש מוצר..." autocomplete="off" aria-label="חיפוש מוצרים"></div>
      <select id="ahProductSort" aria-label="מיון מוצרים"><option value="default">מיון רגיל</option><option value="low">מחיר: מהנמוך לגבוה</option><option value="high">מחיר: מהגבוה לנמוך</option><option value="name">שם המוצר</option></select>
      <button id="ahFavoritesOnly" class="ahFavFilter" type="button">♡ המועדפים שלי</button>
      <div id="ahResultInfo" class="ahResultInfo"></div>`;
    grid.parentNode.insertBefore(tools, grid);

    const noResults = document.createElement('div');
    noResults.id = 'ahNoResults';
    noResults.className = 'ahNoResults';
    noResults.textContent = 'לא מצאנו מוצרים שמתאימים לחיפוש.';
    grid.insertAdjacentElement('afterend', noResults);

    const search = document.getElementById('ahProductSearch');
    const sort = document.getElementById('ahProductSort');
    const favButton = document.getElementById('ahFavoritesOnly');
    let favoritesOnly = false;
    let applying = false;

    function list() {
      try { return typeof products !== 'undefined' && Array.isArray(products) ? products : []; } catch { return []; }
    }
    function currentCategory() {
      return document.querySelector('.cat.active')?.dataset?.filter || 'all';
    }
    function productsForCategory() {
      const cat = currentCategory();
      return list().filter(p => cat === 'all' || (Array.isArray(p.cat) && p.cat.includes(cat)));
    }
    function favorites() {
      try {
        const value = JSON.parse(localStorage.getItem('alufFavorites') || '[]');
        return new Set(Array.isArray(value) ? value.map(String) : []);
      } catch { return new Set(); }
    }
    function searchable(product) {
      return [product.name, product.desc, product.kind, ...(Array.isArray(product.cat) ? product.cat : [])].filter(Boolean).join(' ').toLocaleLowerCase('he');
    }
    function mapFreshCards() {
      const cards = Array.from(grid.querySelectorAll('.product'));
      const visibleProducts = productsForCategory();
      cards.forEach((card, index) => {
        if (!card.dataset.ahProductId) {
          const product = visibleProducts[index];
          if (product) card.dataset.ahProductId = String(product.id);
        }
      });
      return cards;
    }
    function apply() {
      if (applying) return;
      applying = true;
      try {
        const query = String(search.value || '').trim().toLocaleLowerCase('he');
        const favs = favorites();
        const byId = new Map(list().map(p => [String(p.id), p]));
        const cards = mapFreshCards();
        let shown = 0;
        for (const card of cards) {
          const product = byId.get(String(card.dataset.ahProductId || ''));
          if (!product) continue;
          const matchText = !query || searchable(product).includes(query);
          const matchFav = !favoritesOnly || favs.has(String(product.id));
          const show = matchText && matchFav;
          card.style.display = show ? '' : 'none';
          if (show) shown++;
        }

        const mode = sort.value;
        const compare = (a, b) => {
          const pa = byId.get(String(a.dataset.ahProductId || ''));
          const pb = byId.get(String(b.dataset.ahProductId || ''));
          if (!pa || !pb) return 0;
          if (mode === 'low') return Number(pa.price || 0) - Number(pb.price || 0);
          if (mode === 'high') return Number(pb.price || 0) - Number(pa.price || 0);
          if (mode === 'name') return String(pa.name || '').localeCompare(String(pb.name || ''), 'he');
          return list().findIndex(x => String(x.id) === String(pa.id)) - list().findIndex(x => String(x.id) === String(pb.id));
        };
        [...cards].sort(compare).forEach(card => grid.appendChild(card));

        document.getElementById('ahResultInfo').textContent = query || favoritesOnly ? `${shown} מוצרים מתאימים` : '';
        noResults.classList.toggle('show', shown === 0 && cards.length > 0);
        favButton.classList.toggle('on', favoritesOnly);
        favButton.textContent = favoritesOnly ? '♥ מציג מועדפים' : '♡ המועדפים שלי';
      } finally {
        applying = false;
      }
    }

    search.addEventListener('input', apply);
    sort.addEventListener('change', apply);
    favButton.addEventListener('click', () => { favoritesOnly = !favoritesOnly; apply(); });
    document.querySelectorAll('.cat').forEach(button => button.addEventListener('click', () => setTimeout(() => {
      Array.from(grid.querySelectorAll('.product')).forEach(card => delete card.dataset.ahProductId);
      apply();
    }, 30)));
    document.querySelector('.iconBtn.search')?.addEventListener('click', () => {
      tools.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => search.focus(), 350);
    });

    const observer = new MutationObserver(() => setTimeout(apply, 0));
    observer.observe(grid, { childList: true, subtree: true });
    apply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 50));
  else setTimeout(boot, 50);
})();
