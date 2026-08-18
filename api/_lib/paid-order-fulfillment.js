const { loadOrderForFulfillment } = require('./fulfillment');
const { fulfillCjOrder } = require('./cj-fulfillment');
const { fulfillAliExpressOrder } = require('./aliexpress-fulfillment');
const { enabled: manualAliExpressEnabled, queueManualAliExpressOrder } = require('./manual-aliexpress-fulfillment');

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
  if (provider === 'aliexpress') {
    const result = await fulfillAliExpressOrder(orderId);
    // Manual queueing is only a fallback before any live AliExpress order request.
    // Once a request was sent, a second/manual recreation could duplicate the order.
    if (result.manualFulfillmentEligible && result.liveSupplierRequestSent !== true && manualAliExpressEnabled()) {
      return queueManualAliExpressOrder(order, result);
    }
    return result;
  }
  return { ok: false, skipped: true, reason: 'unsupported_supplier', provider };
}

module.exports = { providerSet, fulfillPaidOrder };
