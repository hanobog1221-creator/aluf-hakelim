import { createRequire } from 'node:module';
import { waitUntil } from '@vercel/functions';

const require = createRequire(import.meta.url);
const { serverConfig, serverHeaders } = require('./_lib/supabase-server');
const { fulfillPaidOrder } = require('./_lib/paid-order-fulfillment');
const { whopConfig, verifyWhopSignature, whopOrderId } = require('./_lib/whop-security');

function clean(value, max = 300) { return String(value ?? '').trim().slice(0, max); }
function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

async function readOrder(orderId) {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=order_id,status,payment_status,payment_provider,payment_reference,currency,total,shipping_cost&limit=1`, { headers: serverHeaders() });
  if (!response.ok) throw new Error(`order_read_${response.status}`);
  return (await response.json())[0] || null;
}

async function confirmPayment(event, webhookId, cfg) {
  const payment = event.data || {};
  const orderId = whopOrderId(event);
  const paymentId = clean(payment.id, 120);
  const checkoutId = clean(payment.checkout_configuration_id, 120);
  const currency = clean(payment.currency, 3).toUpperCase();
  const amount = Number(payment.total);
  if (!orderId || !/^pay_[A-Za-z0-9]+$/.test(paymentId) || !/^ch_[A-Za-z0-9]+$/.test(checkoutId)) throw new Error('whop_payment_metadata_invalid');
  if (currency !== cfg.currency || !Number.isFinite(amount) || amount <= 0) throw new Error('whop_payment_amount_invalid');
  const order = await readOrder(orderId);
  if (!order) throw new Error('order_not_found');
  if (order.payment_status === 'paid' && order.payment_provider === 'whop' && order.payment_reference === paymentId) return { orderId, duplicate: true };
  if (order.payment_provider !== 'whop' || order.payment_reference !== checkoutId) throw new Error('whop_checkout_mismatch');
  const expected = Number((Number(order.total || 0) + Number(order.shipping_cost || 0)).toFixed(2));
  if (currency !== clean(order.currency, 3).toUpperCase() || Number(amount.toFixed(2)) !== expected) throw new Error('whop_payment_amount_mismatch');

  const { supabaseUrl } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/confirm_order_payment`, {
    method: 'POST',
    headers: serverHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      p_provider: 'whop', p_provider_event_id: webhookId, p_order_id: orderId,
      p_amount: amount, p_currency: currency, p_payment_reference: paymentId,
      p_payload: { paymentId, checkoutId, status: clean(payment.status, 40), paidAt: payment.paid_at || null }
    })
  });
  if (!response.ok) throw new Error(`confirm_order_payment_${response.status}`);
  const confirmed = await response.json();
  if (!confirmed?.ok) throw new Error(confirmed?.error || 'payment_confirmation_failed');
  return { orderId, duplicate: false };
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    try {
      const cfg = whopConfig();
      if (!cfg.webhookSecret) throw new Error('whop_webhook_not_configured');
      const rawBody = Buffer.from(await request.arrayBuffer());
      const headers = Object.fromEntries(request.headers.entries());
      if (!verifyWhopSignature(rawBody, headers, cfg.webhookSecret)) return json({ ok: false, error: 'invalid_webhook_signature' }, 401);
      const event = JSON.parse(rawBody.toString('utf8'));
      const eventCompanyId = clean(event.company_id || event.account_id, 100);
      if (event.api_version !== 'v1' || eventCompanyId !== cfg.companyId) return json({ ok: false, error: 'invalid_webhook_scope' }, 400);
      if (event.type !== 'payment.succeeded') return json({ ok: true, ignored: true });
      if (!whopOrderId(event)) return json({ ok: true, ignored: true, reason: 'unlinked_payment' });
      const result = await confirmPayment(event, clean(headers['webhook-id'], 300), cfg);
      if (!result.duplicate) {
        waitUntil(fulfillPaidOrder(result.orderId).catch((error) => console.error('Supplier fulfillment after Whop payment failed:', error.message)));
      }
      return json({ ok: true, duplicate: result.duplicate });
    } catch (error) {
      console.error('Whop webhook failed:', error.message);
      const badRequest = /invalid|mismatch|not_found/.test(String(error.message || ''));
      return json({ ok: false, error: badRequest ? clean(error.message, 160) : 'whop_webhook_failed' }, badRequest ? 400 : 500);
    }
  }
};
