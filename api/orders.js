module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const items = Array.isArray(body.items) ? body.items : [];

    if (!items.length) {
      return res.status(400).json({ ok: false, error: 'empty_cart' });
    }

    const normalized = items.map((item) => ({
      id: String(item.id || ''),
      name: String(item.name || ''),
      qty: Math.max(1, Number(item.qty || 1)),
      price: Number(item.price || 0),
      variant: item.variant ? String(item.variant) : null,
      supplierUrl: item.url ? String(item.url) : null
    })).filter((item) => item.id && item.name && Number.isFinite(item.price));

    if (!normalized.length) {
      return res.status(400).json({ ok: false, error: 'invalid_items' });
    }

    const total = normalized.reduce((sum, item) => sum + item.price * item.qty, 0);
    const orderId = `AH-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    return res.status(200).json({
      ok: true,
      orderId,
      status: 'draft',
      total: Number(total.toFixed(2)),
      currency: 'ILS',
      items: normalized
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
};
