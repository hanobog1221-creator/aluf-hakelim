const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(name) {
  return fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
}

test('admin product cards separate item price, checkout shipping, and customer total', () => {
  const source = read('admin-enhancements.js');
  assert.match(source, /מחיר המוצר באתר/);
  assert.match(source, /משלוח שמתווסף בקופה/);
  assert.match(source, /סה״כ שהלקוח משלם/);
  assert.match(source, /רווח נטו אחרי עמלת Whop/);
  assert.doesNotMatch(source, /estimatedNetProfit >= 20/);
});

test('profitability screen describes the live ten-shekel fee-only policy', () => {
  const source = read('admin-profitability.html');
  assert.match(source, /עלות ספק \+ משלוח \+ עמלת Whop/);
  assert.match(source, /סה״כ ללקוח/);
  assert.doesNotMatch(source, /מע״מ 18%/);
  assert.doesNotMatch(source, /\?\?20/);
});
