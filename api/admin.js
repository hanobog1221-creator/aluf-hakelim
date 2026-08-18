const { requireAdmin } = require('./_lib/_lib/admin');

const handlers = {
  'cj-fulfillment': require('./_lib/admin-routes/cj-fulfillment'),
  'cj': require('./_lib/admin-routes/cj'),
  'orders': require('./_lib/admin-routes/orders'),
  'aliexpress-manual': require('./_lib/admin-routes/aliexpress-manual'),
  'aliexpress-tracking': require('./_lib/admin-routes/aliexpress-tracking'),
  'product-intake': require('./_lib/admin-routes/product-intake'),
  'products': require('./_lib/admin-routes/products'),
  'session': require('./_lib/admin-routes/session'),
  'supplier-capture': require('./_lib/admin-routes/supplier-capture'),
  'cj-worker-sourcing': require('./_lib/admin-routes/cj-worker-sourcing'),
  'cj-worker-catalog': require('./_lib/admin-routes/cj-worker-catalog'),
  'cj-worker-status': require('./_lib/admin-routes/cj-worker-status'),
  'cj-worker-orders': require('./_lib/admin-routes/cj-worker-orders'),
  'paypal-test': require('./_lib/admin-routes/paypal-test'),
  'paypal-refund': require('./_lib/admin-routes/paypal-refund'),
  'paypal-credentials': require('./_lib/admin-routes/paypal-credentials'),
  'launch-readiness': require('./_lib/admin-routes/launch-readiness')
};

function parsedBody(req) {
  try { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
  catch { return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const route = String(req.query?.route || '').trim();
  const selected = handlers[route];
  if (!selected) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(404).json({ ok: false, error: 'admin_route_not_found' });
  }

  if (route === 'orders' && req.method === 'PATCH') {
    const body = parsedBody(req);
    const status = String(body.refund_status || '').trim().toLowerCase();
    if (status === 'partial' || status === 'refunded') {
      if (!await requireAdmin(req, res)) return;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(409).json({ ok: false, error: 'completed_refund_requires_provider_route' });
    }
  }

  return selected(req, res);
};
