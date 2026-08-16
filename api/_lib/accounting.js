function roundMoney(value) {
  const n = Number(value || 0);
  return Number((Number.isFinite(n) ? n : 0).toFixed(2));
}

function paidTotal(order) {
  return roundMoney(Number(order?.total || 0) + Number(order?.shipping_cost || 0));
}

function refundIsCompleted(order) {
  const status = String(order?.refund_status || 'none');
  return status === 'partial' || status === 'refunded' || Boolean(order?.refunded_at);
}

function completedRefundAmount(order) {
  if (!refundIsCompleted(order)) return 0;
  const amount = roundMoney(order?.refund_amount || 0);
  if (amount <= 0) return 0;
  const gross = paidTotal(order);
  return roundMoney(Math.min(amount, Math.max(0, gross)));
}

function summarizeAccounting(orders, expensesSummary = {}) {
  const summary = {
    orders: 0,
    productsSubtotal: 0,
    discounts: 0,
    shipping: 0,
    grossRevenue: 0,
    refunds: 0,
    netRevenue: 0,
    revenue: 0,
    documentsIssued: 0,
    documentsMissing: 0,
    recordedExpenses: roundMoney(expensesSummary.total || 0),
    refundExpensesRecorded: roundMoney(expensesSummary.refunds || 0),
    operatingExpenses: 0,
    estimatedNetBeforeTax: 0,
    refundSyncDifference: 0
  };

  for (const order of Array.isArray(orders) ? orders : []) {
    summary.orders += 1;
    summary.productsSubtotal += Number(order.products_subtotal || 0);
    summary.discounts += Number(order.discount_amount || 0);
    summary.shipping += Number(order.shipping_cost || 0);
    summary.grossRevenue += paidTotal(order);
    summary.refunds += completedRefundAmount(order);
    if (order.fiscal_document_status === 'issued') summary.documentsIssued += 1;
    else summary.documentsMissing += 1;
  }

  for (const key of ['productsSubtotal','discounts','shipping','grossRevenue','refunds']) {
    summary[key] = roundMoney(summary[key]);
  }

  summary.netRevenue = roundMoney(summary.grossRevenue - summary.refunds);
  // Backward-compatible alias for older admin UIs: revenue now means net revenue after completed refunds.
  summary.revenue = summary.netRevenue;
  summary.operatingExpenses = roundMoney(Math.max(0, summary.recordedExpenses - summary.refundExpensesRecorded));
  summary.estimatedNetBeforeTax = roundMoney(summary.netRevenue - summary.operatingExpenses);
  summary.refundSyncDifference = roundMoney(summary.refunds - summary.refundExpensesRecorded);
  return summary;
}

module.exports = {
  roundMoney,
  paidTotal,
  refundIsCompleted,
  completedRefundAmount,
  summarizeAccounting
};
