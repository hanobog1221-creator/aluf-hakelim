const productHandler = require('./aliexpress/product-v2');

module.exports = async function handler(req, res) {
  const forwarded = {
    ...req,
    method: 'GET',
    query: { sync: 'all' },
    headers: { ...req.headers, authorization: `Bearer ${process.env.CRON_SECRET || ''}` }
  };
  return productHandler(forwarded, res);
};
