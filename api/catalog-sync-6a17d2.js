const productHandler = require('./aliexpress/product-v2');
module.exports = async function handler(req, res) {
  return productHandler({
    ...req, method: 'GET', query: { sync: 'all' },
    headers: { ...req.headers, authorization: `Bearer ${process.env.CRON_SECRET || ''}` }
  }, res);
};
