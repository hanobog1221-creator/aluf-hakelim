const { loadOrderForFulfillment } = require('./fulfillment');
const { fulfillCjOrder } = require('./cj-fulfillment');
const { preflightAliExpressOrder } = require('./aliexpress-fulfillment');

function providerSet(order) {
  return new Set((Array.isArray(order?.items) ? order.items : [])
    .map((item) => String(item?.supplier || '').trim().toLowerCase())
    .filter(Boolean));
}

async function fulfillPaidOrder(orderId) {
  const order = await loadOrderForFulfillment(orderId);
  const providers = providerSet(order);
  if (providers.size !== 1) {
    return { ok: false, skipped: true, reason: providers.size ? 'mixed_supplier_order_requires_split' : 'supplier_missing' };
  }
  const provider = [...providers][0];
  if (provider === 'cj') return fulfillCjOrder(orderId);
  if (provider === 'aliexpress') return preflightAliExpressOrder(orderId);
  return { ok: false, skipped: true, reason: 'unsupported_supplier', provider };
}

module.exports = { providerSet, fulfillPaidOrder };
