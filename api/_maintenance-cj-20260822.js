const handler = require('./_maintenance-20260822');
module.exports = (req, res) => {
  req.query = { ...(req.query || {}), action: 'cj' };
  return handler(req, res);
};
