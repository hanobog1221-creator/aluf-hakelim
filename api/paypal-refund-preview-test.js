const { requireWorker } = require('./_lib/cj-worker-auth');
const { issuePayPalRefund } = require('./_lib/paypal-refund');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({ ok: false, error: 'not_found' });
  if (!await requireWorker(req, res)) return;
  const orderId = String(req.query?.orderId || '').trim().toUpperCase();
  const amount = Number(req.query?.amount || 1);
  const requestId = String(req.query?.requestId || '').trim();
  if (!/^AH-SBX-PAY-[A-Z0-9-]{5,60}$/.test(orderId)) return res.status(400).json({ ok: false, error: 'sandbox_order_required' });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 5) return res.status(400).json({ ok: false, error: 'test_amount_must_be_0_to_5' });
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) return res.status(400).json({ ok: false, error: 'test_request_id_required' });
  try {
    const out = await issuePayPalRefund(orderId, amount, requestId);
    return res.status(200).json({
      ok: out.ok,
      deduplicated: out.deduplicated === true,
      orderId: out.orderId,
      refundId: out.refundId,
      status: out.status,
      amount: out.amount,
      currency: out.currency,
      environment: out.environment,
      completedTotal: out.completedTotal,
      remaining: out.remaining,
      refundStatus: out.order?.refund_status || null,
      paymentStatus: out.order?.payment_status || null,
      supplierCancellationRequired: out.supplierCancellationRequired === true
    });
  } catch (error) {
    return res.status(409).json({ ok: false, error: String(error?.message || error).slice(0, 220) });
  }
};
