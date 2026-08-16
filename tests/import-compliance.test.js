const test = require('node:test');
const assert = require('node:assert/strict');
const { buildImportCompliancePlan } = require('../api/_lib/import-compliance');

function item(id, price, supplierId, alternatives = []) {
  return {
    id, name: id, qty: 1, price, supplier: 'aliexpress', supplierId,
    supplierProductId: `10000000${id.length}`, supplierSkuId: `sku-${id}`,
    alternativeSuppliers: alternatives
  };
}

test('creates real supplier groups without changing values or quantities', () => {
  const items = [item('a', 200, 'store-a'), item('b', 180, 'store-b')];
  const plan = buildImportCompliancePlan(items, { usdIlsRate: 4, thresholdUsd: 75, vatRate: 0.18 });
  assert.equal(plan.groups.length, 2);
  assert.equal(plan.estimatedTaxIls, 0);
  assert.deepEqual(plan.assignedItems.map((entry) => [entry.id, entry.price, entry.qty]), [['a', 200, 1], ['b', 180, 1]]);
});

test('moves a whole line to a verified alternative supplier when it removes the excess', () => {
  const alternative = {
    supplier_id: 'store-b', supplier: 'aliexpress', supplier_product_id: '1000000099',
    supplier_sku_id: 'sku-alt', verified: true, in_stock: true, shipping_available: true
  };
  const items = [item('a', 180, 'store-a'), item('b', 140, 'store-a', [alternative])];
  const plan = buildImportCompliancePlan(items, { usdIlsRate: 4, thresholdUsd: 75, vatRate: 0.18 });
  assert.equal(plan.substitutions.length, 1);
  assert.equal(plan.assignedItems.find((entry) => entry.id === 'b').supplierId, 'store-b');
  assert.equal(plan.estimatedTaxIls, 0);
});

test('rejects unverified alternatives and estimates tax instead of artificial splitting', () => {
  const unverified = {
    supplier_id: 'store-b', supplier_product_id: '1000000099', supplier_sku_id: 'sku-alt',
    verified: false, in_stock: true, shipping_available: true
  };
  const items = [item('a', 200, 'store-a'), item('b', 160, 'store-a', [unverified])];
  const plan = buildImportCompliancePlan(items, { usdIlsRate: 4, thresholdUsd: 75, vatRate: 0.18 });
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].valueUsd, 90);
  assert.equal(plan.estimatedTaxIls, 64.8);
  assert.equal(plan.strategy, 'supplier_orders_with_tax_fallback');
});

test('never splits a quantity from one supplier into artificial shipments', () => {
  const items = [{ ...item('a', 160, 'store-a'), qty: 2 }];
  const plan = buildImportCompliancePlan(items, { usdIlsRate: 4, thresholdUsd: 75, vatRate: 0.18 });
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.assignedItems[0].qty, 2);
  assert.equal(plan.groups[0].exceedsThreshold, true);
});

