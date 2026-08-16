const crypto = require('crypto');

function requestFingerprint(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown');
  return crypto.createHash('sha256').update(`order-status:${ip}`, 'utf8').digest('hex');
}

async function consumeLookupRateLimit(req, supabaseUrl, serviceKey) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_api_rate_limit`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_key: requestFingerprint(req),
      p_limit: 30,
      p_window_seconds: 600
    })
  });
  if (!response.ok) throw new Error(`rate_limit_check_${response.status}`);
  return (await response.json()) === true;
}

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

    const allowed = await consumeLookupRateLimit(req, supabaseUrl, serviceKey);
    if (!allowed) {
      res.setHeader('Retry-After', '600');
      return res.status(429).json({ ok: false, error: 'too_many_requests' });
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=order_id,status,payment_status,fulfillment_status,total,products_subtotal,discount_amount,coupon_code,currency,shipping_cost,shipping_quote_status,items,customer,tracking_number,customer_note,created_at,updated_at&limit=1`,
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

    const shippingQuoted = order.shipping_quote_status === 'quoted';
    const shippingCost = shippingQuoted ? Number(order.shipping_cost || 0) : null;
    const finalTotal = Number((Number(order.total || 0) + (shippingQuoted ? Number(order.shipping_cost || 0) : 0)).toFixed(2));

    return res.status(200).json({
      ok: true,
      order: {
        orderId: order.order_id,
        status: order.status,
        paymentStatus: order.payment_status,
        fulfillmentStatus: order.fulfillment_status,
        productsSubtotal: Number(order.products_subtotal ?? order.total ?? 0),
        discountAmount: Number(order.discount_amount || 0),
        couponCode: order.coupon_code || null,
        total: finalTotal,
        currency: order.currency || 'ILS',
        shippingCost,
        shippingStatus: order.shipping_quote_status || 'not_quoted',
        trackingNumber: order.tracking_number || null,
        customerNote: order.customer_note || null,
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
