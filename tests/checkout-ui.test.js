const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const checkout = fs.readFileSync(path.join(__dirname, '..', 'checkout.js'), 'utf8');
const storefront = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('checkout presents a branded responsive order review instead of a plain text payment box', () => {
  assert.match(checkout, /אלוף הכלים/);
  assert.match(checkout, /קופה מאובטחת/);
  assert.match(checkout, /ahCheckoutLayout/);
  assert.match(checkout, /ahOrderItems/);
  assert.match(checkout, /סיכום לתשלום/);
  assert.match(checkout, /עדיין לא בוצע חיוב/);
  assert.match(checkout, /@media\(max-width:780px\)/);
});

test('checkout resets scroll position and keeps page locking in sync', () => {
  assert.match(checkout, /scrollTop=0/);
  assert.match(checkout, /document\.body\.classList\.add\('locked'\)/);
  assert.match(checkout, /document\.body\.classList\.remove\('locked'\)/);
});

test('storefront cache-busts the redesigned checkout bundle', () => {
  assert.match(storefront, /checkout\.js\?v=20260829-1/);
});
