const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'catalog-loader.js'), 'utf8');

test('active products remain visible while supplier verification is pending', () => {
  assert.match(source, /filter\(\(product\) => product\.available !== false\)/);
  assert.doesNotMatch(source, /product\.available !== false && product\.purchaseReady === true/);
});

test('purchases remain blocked until supplier verification is complete', () => {
  assert.match(source, /product\.purchaseReady !== true/);
  assert.match(source, /addButton\.disabled = true/);
});
