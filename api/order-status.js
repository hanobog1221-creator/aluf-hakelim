const crypto = require('crypto');
const { serverHeaders } = require('./_lib/supabase-server');
const { refreshAliExpressTracking } = require('./_lib/aliexpress-tracking');

function requestFingerprint(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown');
  return crypto.createHash('sha256').update(`order-status:${ip}`, 'utf8').digest('hex');
}

async function consumeLookupRateLimit(req, supabaseUrl, serviceKey) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_api_rate_limit`, {
    method: 'POST',
    headers: serverHeaders({ 'Content-Type': 'application/json' }, serviceKey),
    body: JSON.stringify({
      p_key: requestFingerprint(req),
      p_limit: 30,
      p_window_seconds: 600
    })
  });
  if (!response.ok) throw new Error(`rate_limit_check_${response.status}`);
  return (await response.json()) === true;
}

function safeTrackingUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url.slice(0, 500) : null;
}

function safeEvent(value) {
  if (!value || typeof value !== 'object') return null;
  const clean = (v, max) => String(v || '').trim().slice(0, max) || null;
  const event = {
    description: clean(value.description, 400),
    status: clean(value.status, 100),
    address: clean(value.address, 400),
    eventDate: clean(value.eventDate, 100)
  };
  return Object.values(event).some(Boolean) ? event : null;
}

function safePickupPoint(value) {
  if (!value || typeof value !== 'object') return null;
  const address = String(value.address || '').trim().slice(0, 400) || null;
  const description = String(value.description || '').trim().slice(0, 400) || null;
  const eventDate = String(value.eventDate || '').trim().slice(0, 100) || null;
  if (!address && !description) return null;
  return { address, description, eventDate };
}

function publicTracking(rows, fallbackNumber) {
  const output = [];
  const seen = new Set();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (!row || typeof row !== 'object') continue;
    const number = String(row.number || '').trim().slice(0, 200);
    if (!number || seen.has(number)) continue;
    seen.add(number);
    output.push({
      number,
      provider: String(row.provider || '').trim().slice(0, 200) || null,
      url: safeTrackingUrl(row.url),
      status: String(row.status || '').trim().toUpperCase().slice(0, 80) || null,
      latestEvent: safeEvent(row.latestEvent),
      pickupPoint: safePickupPoint(row.pickupPoint)
    });
  }
  const fallback = String(fallbackNumber || '').trim().slice(0, 200);
  if (!output.length && fallback) output.push({ number: fallback, provider: null, url: null, status: null, latestEvent: null, pickupPoint: null });
  return output.slice(0, 50);
}

function deliveryMethodFromService(value) {
  const text = String(value || '').normalize('NFKC').trim().toLowerCase();
  if (!text) return 'unknown';
  if (/(pickup|pick[ -]?up|collection|collect point|parcel shop|parcel point|locker|post office|self[ -]?collect|pickup point|pickup station)/i.test(text)) return 'pickup_point';
  if (/(home delivery|deliver(?:y)? to (?:the )?door|door[ -]?to[ -]?door|door delivery|courier to door|courier delivery|home courier)/i.test(text)) return 'home_delivery';
  return 'unknown';
}

function publicDeliveryMethod(quote, trackingRows = []) {
  if ((Array.isArray(trackingRows) ? trackingRows : []).some((row) => row?.pickupPoint)) return 'pickup_point';
  const lines = Array.isArray(quote?.lines) ? quote.lines : [];
  if (!lines.length) return 'unknown';
  const methods = [...new Set(lines.map((line) => deliveryMethodFromService(line?.deliveryMethod || line?.deliveryType || line?.serviceName)))];
  if (methods.length === 1) return methods[0];
  if (methods.every((method) => method === 'home_delivery' || method === 'pickup_point')) return 'mixed';
  return 'unknown';
}

function validLookupOrderId(value) {
  const orderId = String(value || '').trim().toUpperCase();
  const liveFormat = /^AH-[A-Z0-9]+-[A-Z0-9]{4}$/;
  const sandboxFormat = /^AH-SBX-[A-Z0-9-]{8,60}$/;
  return liveFormat.test(orderId) || sandboxFormat.test(orderId);
}

function looksShipped(logisticsStatus) {
  return /(SEND_GOODS|SHIPPED|IN_TRANSIT|DELIVER)/i.test(String(logisticsStatus || ''));
}

async function refreshTrackingIfAvailable(order, supabaseUrl, serviceKey) {
  try {
    const sync = await refreshAliExpressTracking(order);
    if (sync.skipped || !Array.isArray(sync.trackingNumbers) || !sync.trackingNumbers.length) return order;
    const now = new Date().toISOString();
    const update = {
      tracking_number: sync.trackingNumber || order.tracking_number || null,
      tracking_numbers: sync.trackingNumbers,
      updated_at: now
    };
    if (looksShipped(sync.logisticsStatus) && !['completed', 'cancelled'].includes(String(order.status || '')) && !['delivered', 'cancelled'].includes(String(order.fulfillment_status || ''))) {
      update.status = 'shipped';
      update.fulfillment_status = 'shipped';
    }
    const response = await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(order.order_id)}`, {
      method: 'PATCH',
      headers: serverHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, serviceKey),
      body: JSON.stringify(update)
    });
    if (!response.ok) throw new Error(`tracking_update_${response.status}`);
    return { ...order, ...update };
  } catch (error) {
    console.warn('AliExpress tracking refresh skipped:', order.order_id, error.code || error.message);
    return order;
  }
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

    if (!validLookupOrderId(orderId) || phoneDigits.length < 8 || phoneDigits.length > 15) {
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
      `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=order_id,status,payment_status,fulfillment_status,total,products_subtotal,discount_amount,coupon_code,currency,shipping_cost,shipping_quote_status,shipping_quote,items,customer,supplier_order_id,supplier_order_ids,tracking_number,tracking_numbers,customer_note,created_at,updated_at&limit=1`,
      { headers: serverHeaders({}, serviceKey) }
    );

    if (!response.ok) {
      console.error('Order status lookup failed:', response.status, await response.text());
      return res.status(500).json({ ok: false, error: 'lookup_failed' });
    }

    const rows = await response.json();
    let order = rows[0];
    if (!order) return res.status(404).json({ ok: false, error: 'order_not_found' });

    const storedPhone = String(order.customer?.phone || '').replace(/\D/g, '');
    if (!storedPhone || storedPhone !== phoneDigits) {
      return res.status(404).json({ ok: false, error: 'order_not_found' });
    }

    order = await refreshTrackingIfAvailable(order, supabaseUrl, serviceKey);

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
    const trackingNumbers = publicTracking(order.tracking_numbers, order.tracking_number);
    const trackingNumber = trackingNumbers.length ? trackingNumbers.map((row) => row.number).join(' · ') : null;

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
        deliveryMethod: publicDeliveryMethod(order.shipping_quote, trackingNumbers),
        trackingNumber,
        trackingNumbers,
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