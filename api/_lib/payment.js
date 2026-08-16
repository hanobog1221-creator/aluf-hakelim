const DEFAULT_QUOTE_MAX_AGE_MINUTES = 30;

function paymentQuoteMaxAgeMs() {
  const raw = Number(process.env.PAYMENT_QUOTE_MAX_AGE_MINUTES || DEFAULT_QUOTE_MAX_AGE_MINUTES);
  const minutes = Number.isFinite(raw) ? Math.max(5, Math.min(180, raw)) : DEFAULT_QUOTE_MAX_AGE_MINUTES;
  return minutes * 60 * 1000;
}

function serverConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('supabase_server_credentials_missing');
  return {
    supabaseUrl,
    serviceKey,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  };
}

function validTimestampWithin(value, maxAgeMs) {
  const ts = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(ts)) return false;
  const age = Date.now() - ts;
  return age >= -60 * 1000 && age <= maxAgeMs;
}

async function loadOrderForPayment(orderId) {
  const { supabaseUrl, headers } = serverConfig();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(String(orderId || ''))}&select=order_id,payment_status,currency,total,shipping_cost,shipping_quote_status,shipping_quoted_at,products_subtotal,discount_amount,coupon_code,terms_accepted_at,terms_version,customer,created_at,updated_at&limit=1`,
    { headers }
  );
  if (!response.ok) throw new Error(`payment_order_read_${response.status}`);
  const order = (await response.json())[0];
  if (!order) throw new Error('order_not_found');
  return order;
}

async function validateCouponForPayment(order) {
  if (!order.coupon_code) return { ok: true, coupon: null };
  const { supabaseUrl, headers } = serverConfig();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/coupons?code=eq.${encodeURIComponent(String(order.coupon_code))}&select=code,active,starts_at,ends_at,usage_limit,used_count&limit=1`,
    { headers }
  );
  if (!response.ok) throw new Error(`payment_coupon_read_${response.status}`);
  const coupon = (await response.json())[0];
  if (!coupon || coupon.active !== true) return { ok: false, reason: 'coupon_unavailable' };

  const now = Date.now();
  if (coupon.starts_at && Date.parse(coupon.starts_at) > now) return { ok: false, reason: 'coupon_not_started' };
  if (coupon.ends_at && Date.parse(coupon.ends_at) < now) return { ok: false, reason: 'coupon_expired' };
  if (coupon.usage_limit != null && Number(coupon.used_count || 0) >= Number(coupon.usage_limit)) {
    return { ok: false, reason: 'coupon_limit_reached' };
  }
  return { ok: true, coupon };
}

async function getPaymentPreflight(orderId) {
  const order = await loadOrderForPayment(orderId);
  if (order.payment_status === 'paid') return { ok: false, reason: 'order_already_paid', order };
  if (!['unpaid', 'pending', 'failed'].includes(String(order.payment_status || ''))) {
    return { ok: false, reason: 'payment_status_not_eligible', order };
  }
  if (!order.terms_accepted_at || !String(order.terms_version || '').trim()) {
    return { ok: false, reason: 'terms_not_accepted', order };
  }
  if (order.shipping_quote_status !== 'quoted') {
    return { ok: false, reason: 'shipping_not_quoted', order };
  }
  if (!validTimestampWithin(order.shipping_quoted_at, paymentQuoteMaxAgeMs())) {
    return { ok: false, reason: 'shipping_quote_stale', order };
  }

  const couponCheck = await validateCouponForPayment(order);
  if (!couponCheck.ok) return { ok: false, reason: couponCheck.reason, order };

  const productsTotal = Number(order.total || 0);
  const shippingCost = Number(order.shipping_cost || 0);
  if (!Number.isFinite(productsTotal) || productsTotal < 0 || !Number.isFinite(shippingCost) || shippingCost < 0) {
    return { ok: false, reason: 'invalid_order_amount', order };
  }
  const amount = Number((productsTotal + shippingCost).toFixed(2));
  if (amount <= 0 || amount > 1000000) return { ok: false, reason: 'invalid_payment_amount', order };

  return {
    ok: true,
    orderId: order.order_id,
    amount,
    currency: order.currency || 'ILS',
    quoteMaxAgeMinutes: Math.round(paymentQuoteMaxAgeMs() / 60000),
    couponCode: order.coupon_code || null,
    customer: {
      fullName: order.customer?.fullName || null,
      phone: order.customer?.phone || null,
      email: order.customer?.email || null
    }
  };
}

async function confirmVerifiedPayment({ provider, providerEventId, orderId, amount, currency, paymentReference, payload }) {
  const { supabaseUrl, serviceKey } = serverConfig();

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/confirm_order_payment`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_provider: String(provider || ''),
      p_provider_event_id: String(providerEventId || ''),
      p_order_id: String(orderId || ''),
      p_amount: Number(amount),
      p_currency: String(currency || ''),
      p_payment_reference: paymentReference ? String(paymentReference) : null,
      p_payload: payload && typeof payload === 'object' ? payload : {}
    })
  });

  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { result = null; }
  if (!response.ok || !result) {
    throw new Error(`payment_confirmation_failed_${response.status}_${text.slice(0, 250)}`);
  }
  return result;
}

module.exports = {
  DEFAULT_QUOTE_MAX_AGE_MINUTES,
  getPaymentPreflight,
  confirmVerifiedPayment
};
