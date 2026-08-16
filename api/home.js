module.exports = async function handler(req, res) {
  try {
    const protocol = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = req.headers.host;
    const origin = `${protocol}://${host}`;
    const pageUrl = `${origin}/index.html`;
    const response = await fetch(pageUrl, { headers: { 'cache-control': 'no-cache' } });
    let html = await response.text();

    html = html
      .replaceAll('משלוח לישראל', 'משלוחים לכל הארץ')
      .replaceAll('יש משלוח לישראל?', 'יש משלוחים לכל הארץ?')
      .replaceAll('בהמשך נחבר כאן WhatsApp ושירות ישיר להזמנות ושאלות.', 'לשאלות על מוצרים והזמנות אפשר לפנות אלינו ישירות ב-WhatsApp.');

    const escapeAttr = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

    const requestedProductId = String(req.query?.product || '').trim();
    let selectedProduct = null;
    if (/^[A-Za-z0-9_-]{1,80}$/.test(requestedProductId)) {
      try {
        const productsResponse = await fetch(`${origin}/api/products`, { headers: { accept: 'application/json' }, cache: 'no-store' });
        if (productsResponse.ok) {
          const data = await productsResponse.json();
          selectedProduct = Array.isArray(data?.products)
            ? data.products.find((product) => String(product.id) === requestedProductId) || null
            : null;
        }
      } catch {}
    }

    if (!html.includes('rel="canonical"')) {
      const canonical = selectedProduct
        ? `https://aluf-hakelim-v2-ready.vercel.app/?product=${encodeURIComponent(selectedProduct.id)}`
        : 'https://aluf-hakelim-v2-ready.vercel.app/';
      const title = selectedProduct
        ? `${selectedProduct.name} | אלוף הכלים`
        : 'אלוף הכלים | כלי עבודה ואביזרי רכב';
      const description = selectedProduct?.desc
        ? String(selectedProduct.desc).slice(0, 220)
        : 'אלוף הכלים — כלי עבודה, אביזרי רכב ומוצרים שימושיים להזמנה אונליין.';
      const image = selectedProduct?.img
        ? (String(selectedProduct.img).startsWith('http') ? selectedProduct.img : `${origin}${selectedProduct.img}`)
        : null;
      const structured = selectedProduct ? {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: selectedProduct.name,
        description,
        image: image ? [image] : undefined,
        sku: String(selectedProduct.id),
        offers: {
          '@type': 'Offer',
          url: canonical,
          priceCurrency: 'ILS',
          price: Number(selectedProduct.price || 0).toFixed(2),
          availability: selectedProduct.available === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock'
        }
      } : {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'אלוף הכלים',
        url: canonical,
        inLanguage: 'he-IL'
      };
      const seo = `
<link rel="canonical" href="${escapeAttr(canonical)}">
<meta name="description" content="${escapeAttr(description)}">
<meta property="og:type" content="${selectedProduct ? 'product' : 'website'}">
<meta property="og:locale" content="he_IL">
<meta property="og:site_name" content="אלוף הכלים">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:url" content="${escapeAttr(canonical)}">
${image ? `<meta property="og:image" content="${escapeAttr(image)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${escapeAttr(title)}">
<meta name="twitter:description" content="${escapeAttr(description)}">
${image ? `<meta name="twitter:image" content="${escapeAttr(image)}">` : ''}
<script type="application/ld+json">${safeJson(structured)}</script>`;
      html = html.replace(/<title>.*?<\/title>/i, `<title>${escapeAttr(title)}</title>`);
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
    if (!html.includes('/public-info.js')) {
      html = html.replace('</body>', '<script src="/public-info.js"></script></body>');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).send('Site temporarily unavailable');
  }
};
