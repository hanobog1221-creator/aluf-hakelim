const test = require('node:test');
const assert = require('node:assert/strict');
const { paypalSettlement, estimateOrderProfit } = require('../api/_lib/paypal-finance');

test('extracts PayPal gross fee and net settlement', () => {
  const settlement = paypalSettlement({
    amount: { value: '140.00', currency_code: 'ILS' },
    seller_receivable_breakdown: {
      paypal_fee: { value: '5.10', currency_code: 'ILS' },
      net_amount: { value: '134.90', currency_code: 'ILS' }
    }
  });
  assert.deepEqual(settlement, { gross: 140, fee: 5.1, net: 134.9, currency: 'ILS' });
});

test('calculates remaining profit after PayPal fee, supplier cost and refunds', () => {
  const profit = estimateOrderProfit({
    settlement: { gross: 140, fee: 5.1, net: 134.9 },
    supplierCostIls: 101.76,
    refundAmountIls: 0
  });
  assert.equal(profit.estimatedProfitIls, 33.14);
});
