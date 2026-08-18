const { requireAdmin } = require('../admin');
const { selectedPaymentProvider, providerStatuses } = require('../payment-providers');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!await requireAdmin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  try {
    return res.status(200).json({
      ok: true,
      selected: selectedPaymentProvider(),
      providers: await providerStatuses(),
      realSalesEnabledByThisRoute: false
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 220) });
  }
};
