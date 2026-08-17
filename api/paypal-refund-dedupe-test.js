const { issuePayPalRefund } = require('./_lib/paypal-refund');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({ ok: false, error: 'not_found' });
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  try {
    const out = await issuePayPalRefund('AH-SBX-PAY-MSXIL95T-EC30DD', 1, 'refund-sbx-existing-001');
    return res.status(200).json({
      ok: out.ok,
      deduplicated: out.deduplicated === true,
      orderId: out.orderId,
      refundId: out.refundId,
      status: out.status,
      amount: out.amount,
      completedTotal: out.completedTotal,
      remaining: out.remaining,
      refundStatus: out.order?.refund_status || null
    });
  } catch (error) {
    return res.status(409).json({ ok: false, error: String(error?.message || error).slice(0, 220) });
  }
};
