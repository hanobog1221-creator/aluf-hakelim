const { requireAdmin, audit } = require('../_lib/admin');
const { issuePayPalRefund, syncPayPalRefund } = require('../paypal-refund');

function clean(value, max = 220) { return String(value ?? '').trim().slice(0, max); }

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!await requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = clean(body.action || 'refund', 20).toLowerCase();
    const orderId = clean(body.order_id || body.orderId, 80).toUpperCase();
    if (!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)) return res.status(400).json({ ok: false, error: 'invalid_order_id' });

    let out;
    if (action === 'refund') {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'invalid_refund_amount' });
      out = await issuePayPalRefund(orderId, amount);
      await audit('paypal_refund_issue', 'order', orderId, {
        refundId: out.refundId,
        status: out.status,
        amount: out.amount,
        currency: out.currency,
        environment: out.environment,
        completedTotal: out.completedTotal,
        supplierCancellationRequired: out.supplierCancellationRequired === true
      });
    } else if (action === 'sync') {
      const refundId = clean(body.refund_id || body.refundId, 200);
      if (!refundId) return res.status(400).json({ ok: false, error: 'refund_id_required' });
      out = await syncPayPalRefund(orderId, refundId);
      await audit('paypal_refund_sync', 'order', orderId, {
        refundId,
        status: out.status,
        completedTotal: out.completedTotal ?? null
      });
    } else {
      return res.status(400).json({ ok: false, error: 'invalid_action' });
    }

    return res.status(out.ok === false ? 409 : 200).json(out);
  } catch (error) {
    console.error('PayPal refund admin failed:', error.message);
    const code = clean(error.message || error, 220) || 'paypal_refund_failed';
    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 409;
    return res.status(status).json({ ok: false, error: code });
  }
};
