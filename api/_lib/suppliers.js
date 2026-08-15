// Server-side supplier mapping. Never trust supplier details from the browser.
// Mark readyForFulfillment=true only after the exact AliExpress SKU is verified.

const SUPPLIERS = {
  washer: {
    storeProductId: 'washer',
    supplier: 'aliexpress',
    sourceUrl: 'https://a.aliexpress.com/_c39RYxFp',
    variantLabel: 'Set 1',
    productId: '1005006994420769',
    skuId: null,
    readyForFulfillment: false
  },
  battery588: {
    storeProductId: 'battery588',
    supplier: 'aliexpress',
    sourceUrl: 'https://a.aliexpress.com/_c3mUoejd',
    variantLabel: 'Battery 1 Charger 1',
    productId: '1005008055230578',
    skuId: null,
    readyForFulfillment: false
  }
};

function getSupplierMapping(storeProductId) {
  return SUPPLIERS[String(storeProductId || '')] || null;
}

module.exports = { SUPPLIERS, getSupplierMapping };
