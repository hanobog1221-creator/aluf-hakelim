const productHandler = require('./aliexpress/product-v2');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  return productHandler({ ...req, method: 'GET', query: { productId: '1005012750681706' }, headers: { ...req.headers, authorization: `Bearer ${process.env.CRON_SECRET || ''}` } }, res);
};
