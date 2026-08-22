const handler = require('./_maintenance-20260822');
module.exports = (req, res) => {
  req.query = { ...(req.query || {}), action: 'aliexpress' };
  return handler(req, res);
};
