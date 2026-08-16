async function checkOrderPaymentReadiness(orderId) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('supabase_server_credentials_missing');

  const id = String(orderId || '').trim().toUpperCase();
  if (!/^AH-[A-Z0-9-]{5,60}$/.test(id)) throw new Error('invalid_order_id');

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/check_order_payment_readiness`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_order_id: id })
  });

  const text = await response.text();
  let result = null;
  try { result = JSON.parse(text); } catch {}
  if (!response.ok || !result || typeof result !== 'object') {
    throw new Error(`payment_readiness_failed_${response.status}_${text.slice(0, 160)}`);
  }
  return result;
}

async function requireOrderPaymentReadiness(orderId) {
  const result = await checkOrderPaymentReadiness(orderId);
  if (result.ok !== true) {
    const error = new Error(String(result.reason || 'order_not_ready_for_payment'));
    error.code = String(result.reason || 'order_not_ready_for_payment');
    error.details = result;
    throw error;
  }
  return result;
}

module.exports = {
  checkOrderPaymentReadiness,
  requireOrderPaymentReadiness
};
