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
      qty: Math.max(1, Math.floor(Number(item.qty || 1))),
      price: Number(item.price || 0),
      variant: item.variant ? String(item.variant) : null,
      supplierUrl: item.url ? String(item.url) : null
    })).filter((item) => item.id && item.name && Number.isFinite(item.price) && item.price >= 0);

    if (!normalized.length) {
      return res.status(400).json({ ok: false, error: 'invalid_items' });
    }

    const total = normalized.reduce((sum, item) => sum + item.price * item.qty, 0);
    const orderId = `AH-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const order = {
      order_id: orderId,
      status: 'draft',
      currency: 'ILS',
      total: Number(total.toFixed(2)),
      items: normalized,
      customer: body.customer && typeof body.customer === 'object' ? body.customer : {},
      created_at: new Date().toISOString()
    };

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(200).json({
        ok: true,
        persisted: false,
        storageConfigured: false,
        orderId,
        status: order.status,
        total: order.total,
        currency: order.currency,
        items: normalized
      });
    }

    const dbResponse = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(order)
    });

    if (!dbResponse.ok) {
      const details = await dbResponse.text();
      console.error('Supabase order insert failed:', dbResponse.status, details);
      return res.status(500).json({ ok: false, error: 'order_storage_failed' });
    }

    return res.status(200).json({
      ok: true,
      persisted: true,
      storageConfigured: true,
      orderId,
      status: order.status,
      total: order.total,
      currency: order.currency,
      items: normalized
    });
  } catch (error) {
    console.error('Order API error:', error);
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
};
