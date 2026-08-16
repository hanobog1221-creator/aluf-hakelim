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

    if (!html.includes('/catalog-loader.js')) {
      html = html.replace('</body>', '<script src="/catalog-loader.js"></script></body>');
    }
    if (!html.includes('/checkout.js')) {
      html = html.replace('</body>', '<script src="/checkout.js"></script></body>');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).send('Site temporarily unavailable');
  }
};
