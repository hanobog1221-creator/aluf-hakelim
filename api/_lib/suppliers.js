// Server-side supplier mapping. Never trust supplier details from the browser.
// AliExpress productId/skuId are filled only after they are verified against the AliExpress API.

const SUPPLIERS = {
  washer: {
    storeProductId: 'washer',
    supplier: 'aliexpress',
    sourceUrl: 'https://a.aliexpress.com/_c39RYxFp',
    variantLabel: 'Set 1',
    productId: null,
    skuId: null,
    readyForFulfillment: false
  },
  battery588: {
    storeProductId: 'battery588',
    supplier: 'aliexpress',
    sourceUrl: null,
    variantLabel: 'Battery 1 Charger 1',
    productId: null,
    skuId: null,
    readyForFulfillment: false
  }
};

function getSupplierMapping(storeProductId) {
  return SUPPLIERS[String(storeProductId || '')] || null;
}

module.exports = { SUPPLIERS, getSupplierMapping };
