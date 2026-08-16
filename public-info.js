(() => {
  function boot() {
    const foot = document.querySelector('.foot');
    if (!foot || document.getElementById('ahPublicLinks')) return;
    const box = document.createElement('div');
    box.id = 'ahPublicLinks';
    box.style.display = 'flex';
    box.style.gap = '12px';
    box.style.flexWrap = 'wrap';
    box.style.alignItems = 'center';
    box.innerHTML = '<a href="/policies">משלוחים, החזרות ופרטיות</a><a href="/track">מעקב הזמנה</a>';
    for (const a of box.querySelectorAll('a')) {
      a.style.color = '#fff';
      a.style.textDecoration = 'underline';
      a.style.textUnderlineOffset = '3px';
      a.style.fontWeight = '800';
      a.style.fontSize = '13px';
    }
    foot.appendChild(box);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
