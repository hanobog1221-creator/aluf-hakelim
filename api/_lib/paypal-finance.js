function money(value) {
  const n = Number(value);
  return Number((Number.isFinite(n) ? n : 0).toFixed(2));
}

function paypalSettlement(capture) {
  const gross = money(capture?.amount?.value);
  const breakdown = capture?.seller_receivable_breakdown || {};
  const fee = money(breakdown?.paypal_fee?.value);
  const netReported = Number(breakdown?.net_amount?.value);
  const net = Number.isFinite(netReported) ? money(netReported) : money(gross - fee);
  const currency = String(capture?.amount?.currency_code || '').trim().toUpperCase() || null;
  return { gross, fee, net, currency };
}

function estimateOrderProfit({ settlement, supplierCostIls = 0, refundAmountIls = 0 }) {
  const net = money(settlement?.net);
  const supplierCost = money(supplierCostIls);
  const refunds = money(refundAmountIls);
  return {
    grossRevenueIls: money(settlement?.gross),
    paypalFeeIls: money(settlement?.fee),
    paypalNetIls: net,
    supplierCostIls: supplierCost,
    refundsIls: refunds,
    estimatedProfitIls: money(net - supplierCost - refunds)
  };
}

module.exports = { paypalSettlement, estimateOrderProfit };
