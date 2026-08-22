const paypalHandler = require('./paypal');
const whopHandler = require('./whop');
const { PAYPAL, WHOP, selectedProviderStatus } = require('./_lib/payment-providers');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { selected, status } = await selectedProviderStatus();
    if (!status?.enabled) return res.status(503).json({ ok: false, error: 'payment_provider_disabled', provider: selected });
    if (!status.configured) return res.status(503).json({ ok: false, error: 'payment_provider_not_configured', provider: selected });
    if (selected === PAYPAL) return paypalHandler(req, res);
    if (selected === WHOP) return whopHandler(req, res);
    return res.status(503).json({ ok: false, error: 'payment_provider_disabled', provider: selected });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 220) });
  }
};
