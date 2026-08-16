const test = require('node:test');
const assert = require('node:assert/strict');

const {
  paidTotal,
  completedRefundAmount,
  summarizeAccounting
} = require('../api/_lib/accounting');

function order(overrides = {}) {
  return {
    total: 100,
    shipping_cost: 10,
    products_subtotal: 120,
    discount_amount: 20,
    refund_status: 'none',
    refund_amount: 0,
    refunded_at: null,
    fiscal_document_status: 'issued',
    ...overrides
  };
}

test('paidTotal includes customer shipping', () => {
  assert.equal(paidTotal(order()), 110);
});

test('requested refund is not treated as completed cash outflow on the order itself', () => {
  assert.equal(completedRefundAmount(order({ refund_status: 'requested', refund_amount: 30 })), 0);
});

test('completed partial refund is visible on the order itself', () => {
  assert.equal(completedRefundAmount(order({ refund_status: 'partial', refund_amount: 30 })), 30);
});

test('refund amount is capped at original paid total for per-order reporting safety', () => {
  assert.equal(completedRefundAmount(order({ refund_status: 'refunded', refund_amount: 999 })), 110);
});

test('accounting does not subtract an auto-recorded refund twice', () => {
  const orders = [order({ refund_status: 'partial', refund_amount: 30 })];
  const expensesSummary = {
    total: 50,
    refunds: 30
  };
  const summary = summarizeAccounting(orders, expensesSummary);

  assert.equal(summary.grossRevenue, 110);
  assert.equal(summary.refunds, 30);
  assert.equal(summary.netRevenue, 80);
  assert.equal(summary.recordedExpenses, 50);
  assert.equal(summary.operatingExpenses, 20);
  assert.equal(summary.estimatedNetBeforeTax, 60);
});

test('report-period refund total comes from dated expenses, not the sale order lifetime refund field', () => {
  const orders = [order({ refund_status: 'refunded', refund_amount: 25 })];
  const summary = summarizeAccounting(orders, { total: 0, refunds: 0 });
  assert.equal(summary.grossRevenue, 110);
  assert.equal(summary.refunds, 0);
  assert.equal(summary.netRevenue, 110);
});

test('refund expense in the report period reduces revenue even when no sale from that order is in the period', () => {
  const summary = summarizeAccounting([], { total: 25, refunds: 25 });
  assert.equal(summary.grossRevenue, 0);
  assert.equal(summary.refunds, 25);
  assert.equal(summary.netRevenue, -25);
  assert.equal(summary.operatingExpenses, 0);
  assert.equal(summary.estimatedNetBeforeTax, -25);
});
