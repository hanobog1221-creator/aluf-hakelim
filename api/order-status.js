module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const orderId = String(body.orderId || '').trim().toUpperCase();
    const phoneDigits = String(body.phone || '').replace(/\D/g, '');

    if (!/^AH-[A-Z0-9]+-[A-Z0-9]{4}$/.test(orderId) || phoneDigits.length < 8 || phoneDigits.length > 15) {
      return res.status(400).json({ ok: false, error: 'invalid_lookup' });
    }

    const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ ok: false, error: 'server_not_configured' });
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=order_id,status,payment_status,fulfillment_status,total,currency,shipping_cost,items,customer,tracking_number,created_at,updated_at&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );

    if (!response.ok) {
      console.error('Order status lookup failed:', response.status, await response.text());
      return res.status(500).json({ ok: false, error: 'lookup_failed' });
    }

    const rows = await response.json();
    const order = rows[0];
    if (!order) return res.status(404).json({ ok: false, error: 'order_not_found' });

    const storedPhone = String(order.customer?.phone || '').replace(/\D/g, '');
    if (!storedPhone || storedPhone !== phoneDigits) {
      return res.status(404).json({ ok: false, error: 'order_not_found' });
    }

    const items = Array.isArray(order.items)
      ? order.items.map((item) => ({
          name: String(item.name || ''),
          qty: Number(item.qty || 0),
          price: Number(item.price || 0)
        }))
      : [];

    return res.status(200).json({
      ok: true,
      order: {
        orderId: order.order_id,
        status: order.status,
        paymentStatus: order.payment_status,
        fulfillmentStatus: order.fulfillment_status,
        total: Number(order.total || 0),
        currency: order.currency || 'ILS',
        shippingCost: Number(order.shipping_cost || 0),
        trackingNumber: order.tracking_number || null,
        items,
        createdAt: order.created_at,
        updatedAt: order.updated_at
      }
    });
  } catch (error) {
    console.error('Order status error:', error);
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
};
