const { checkOrderPaymentReadiness } = require('./payment-readiness');

function serverConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('supabase_server_credentials_missing');
  return { supabaseUrl, serviceKey };
}

async function loadPaymentCustomer(orderId) {
  const { supabaseUrl, serviceKey } = serverConfig();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(String(orderId || ''))}&select=customer&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!response.ok) throw new Error(`payment_customer_read_${response.status}`);
  const order = (await response.json())[0];
  if (!order) throw new Error('order_not_found');
  return {
    fullName: order.customer?.fullName || null,
    phone: order.customer?.phone || null,
    email: order.customer?.email || null
  };
}

async function getPaymentPreflight(orderId) {
  const readiness = await checkOrderPaymentReadiness(orderId);
  if (readiness.ok !== true) return readiness;
  const customer = await loadPaymentCustomer(readiness.orderId || orderId);
  return { ...readiness, customer };
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
  getPaymentPreflight,
  confirmVerifiedPayment
};
