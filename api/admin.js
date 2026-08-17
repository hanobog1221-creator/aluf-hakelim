const handlers = {
  'cj-fulfillment': require('./_lib/admin-routes/cj-fulfillment'),
  'cj': require('./_lib/admin-routes/cj'),
  'orders': require('./_lib/admin-routes/orders'),
  'product-intake': require('./_lib/admin-routes/product-intake'),
  'products': require('./_lib/admin-routes/products'),
  'session': require('./_lib/admin-routes/session'),
  'supplier-capture': require('./_lib/admin-routes/supplier-capture'),
  'cj-worker-sourcing': require('./_lib/admin-routes/cj-worker-sourcing'),
  'cj-worker-catalog': require('./_lib/admin-routes/cj-worker-catalog'),
  'cj-worker-status': require('./_lib/admin-routes/cj-worker-status'),
  'cj-worker-orders': require('./_lib/admin-routes/cj-worker-orders'),
  'paypal-test': require('./_lib/admin-routes/paypal-test')
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const route = String(req.query?.route || '').trim();
  const selected = handlers[route];
  if (!selected) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(404).json({ ok: false, error: 'admin_route_not_found' });
  }
  return selected(req, res);
};
