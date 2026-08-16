(() => {
  function addFooterLinks() {
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

  function addWhatsAppPopup(attempt = 0) {
    if (document.getElementById('ahWaHelpPopup')) return;
    const contact = window.alufStoreContact;
    const floatButton = document.getElementById('ahWaFloat');
    if ((!contact || !contact.whatsappNumber || typeof contact.whatsappUrl !== 'function') && attempt < 30) {
      setTimeout(() => addWhatsAppPopup(attempt + 1), 200);
      return;
    }
    if (!contact || !contact.whatsappNumber || typeof contact.whatsappUrl !== 'function') return;

    const style = document.createElement('style');
    style.textContent = `
      .ahWaHelpPopup{position:fixed;left:18px;bottom:82px;z-index:146;width:min(315px,calc(100vw - 28px));background:#fff;border:1px solid #dfe5e8;border-radius:17px;box-shadow:0 16px 45px #0003;overflow:hidden;opacity:0;transform:translateY(12px);pointer-events:none;transition:.24s ease}
      .ahWaHelpPopup.show{opacity:1;transform:translateY(0);pointer-events:auto}.ahWaHelpTop{background:#075e54;color:#fff;padding:13px 14px;display:flex;align-items:center;gap:9px}.ahWaHelpTop strong{font-size:14px}.ahWaHelpTop small{display:block;color:#d9f3e8;margin-top:2px}.ahWaHelpClose{margin-right:auto;border:0;background:transparent;color:#fff;font-size:22px;cursor:pointer}.ahWaHelpBody{padding:14px}.ahWaHelpBody p{margin:0 0 12px;font-size:14px;line-height:1.55;color:#34414b}.ahWaHelpOpen{display:block;text-align:center;background:#25D366;color:#073b1a;border-radius:11px;padding:11px 13px;text-decoration:none;font-weight:950}
      @media(max-width:620px){.ahWaHelpPopup{left:10px;bottom:70px;width:min(300px,calc(100vw - 20px))}}
    `;
    document.head.appendChild(style);

    const popup = document.createElement('div');
    popup.id = 'ahWaHelpPopup';
    popup.className = 'ahWaHelpPopup';
    popup.innerHTML = '<div class="ahWaHelpTop"><span style="font-size:24px">💬</span><div><strong>אלוף הכלים ב-WhatsApp</strong><small>צריכים עזרה?</small></div><button class="ahWaHelpClose" type="button" aria-label="סגור">×</button></div><div class="ahWaHelpBody"><p><b>אפשר לעזור?</b><br>שלחו לנו הודעה ונעזור לכם לבחור את המוצר המתאים.</p><a class="ahWaHelpOpen" target="_blank" rel="noopener noreferrer">פתיחת WhatsApp</a></div>';
    popup.querySelector('.ahWaHelpOpen').href = contact.whatsappUrl('אשמח לעזרה בבחירת מוצר.');
    popup.querySelector('.ahWaHelpClose').addEventListener('click', () => popup.classList.remove('show'));
    floatButton?.addEventListener('click', () => popup.classList.remove('show'));
    document.body.appendChild(popup);
    setTimeout(() => popup.classList.add('show'), 900);
  }

  function boot() {
    addFooterLinks();
    setTimeout(() => addWhatsAppPopup(), 300);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
