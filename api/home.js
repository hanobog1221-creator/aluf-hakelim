module.exports = async function handler(req, res) {
  try {
    const protocol = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = req.headers.host;
    const pageUrl = `${protocol}://${host}/index.html`;
    const response = await fetch(pageUrl, { headers: { 'cache-control': 'no-cache' } });
    let html = await response.text();

    html = html
      .replaceAll('משלוח לישראל', 'משלוחים לכל הארץ')
      .replaceAll('יש משלוח לישראל?', 'יש משלוחים לכל הארץ?');

    if (!html.includes('rel="canonical"')) {
      const canonical = 'https://aluf-hakelim-v2-ready.vercel.app/';
      const seo = `
<link rel="canonical" href="${canonical}">
<meta name="description" content="אלוף הכלים — כלי עבודה, אביזרי רכב ומוצרים שימושיים להזמנה אונליין.">
<meta property="og:type" content="website">
<meta property="og:locale" content="he_IL">
<meta property="og:site_name" content="אלוף הכלים">
<meta property="og:title" content="אלוף הכלים | כלי עבודה ואביזרי רכב">
<meta property="og:description" content="כלי עבודה, אביזרי רכב ומוצרים שימושיים להזמנה אונליין.">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'אלוף הכלים',
        url: canonical,
        inLanguage: 'he-IL'
      })}</script>`;
      html = html.replace('</head>', `${seo}\n</head>`);
    }

    if (!html.includes('/catalog-loader.js')) {
      html = html.replace('</body>', '<script src="/catalog-loader.js"></script></body>');
    }
    if (!html.includes('/checkout.js')) {
      html = html.replace('</body>', '<script src="/checkout.js"></script></body>');
    }
    if (!html.includes('/store-tools.js')) {
      html = html.replace('</body>', '<script src="/store-tools.js"></script></body>');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).send('Site temporarily unavailable');
  }
};
