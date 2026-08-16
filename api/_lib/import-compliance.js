const DEFAULT_THRESHOLD_USD = 75;
const DEFAULT_VAT_RATE = 0.18;

function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

function validSupplierId(value) {
  const id = String(value || '').trim();
  return id && id.length <= 160 ? id : null;
}

function lineValueUsd(item, usdIlsRate) {
  const explicit = Number(item.importValueUsd);
  if (Number.isFinite(explicit) && explicit >= 0) return money(explicit * Number(item.qty || 0));
  const ils = Number(item.price) * Number(item.qty || 0);
  return money(ils / usdIlsRate);
}

function normalizeAlternative(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const supplierId = validSupplierId(candidate.supplier_id ?? candidate.supplierId);
  const productId = String(candidate.supplier_product_id ?? candidate.supplierProductId ?? '').trim();
  const skuId = String(candidate.supplier_sku_id ?? candidate.supplierSkuId ?? '').trim();
  if (!supplierId || !productId || !skuId) return null;
  if (candidate.verified !== true || candidate.in_stock !== true || candidate.shipping_available !== true) return null;
  return {
    supplierId,
    supplier: String(candidate.supplier || 'aliexpress'),
    supplierUrl: candidate.supplier_url ?? candidate.supplierUrl ?? null,
    supplierProductId: productId,
    supplierSkuId: skuId,
    variant: candidate.variant_label ?? candidate.variant ?? null,
    source: 'verified_alternative'
  };
}

function groupItems(items, usdIlsRate) {
  const groups = new Map();
  for (const item of items) {
    const supplierId = validSupplierId(item.supplierId) || 'supplier-identity-missing';
    if (!groups.has(supplierId)) groups.set(supplierId, []);
    groups.get(supplierId).push(item);
  }
  return [...groups.entries()].map(([supplierId, group]) => ({
    supplierId,
    items: group,
    valueUsd: money(group.reduce((sum, item) => sum + lineValueUsd(item, usdIlsRate), 0))
  }));
}

function chooseVerifiedAlternatives(items, thresholdUsd, usdIlsRate) {
  const assigned = items.map((item) => ({ ...item }));
  const substitutions = [];

  // Move a whole order line only to a genuinely different, verified supplier.
  // Quantities are never split and declared/customer values are never changed.
  for (let pass = 0; pass < assigned.length; pass += 1) {
    const groups = groupItems(assigned, usdIlsRate);
    const over = groups.filter((group) => group.valueUsd > thresholdUsd);
    if (!over.length) break;
    let best = null;

    for (const group of over) {
      for (const item of group.items) {
        const alternatives = (Array.isArray(item.alternativeSuppliers) ? item.alternativeSuppliers : [])
          .map(normalizeAlternative)
          .filter(Boolean)
          .filter((candidate) => candidate.supplierId !== group.supplierId);
        for (const candidate of alternatives) {
          const target = groups.find((entry) => entry.supplierId === candidate.supplierId);
          const value = lineValueUsd(item, usdIlsRate);
          const sourceAfter = money(group.valueUsd - value);
          const targetAfter = money((target?.valueUsd || 0) + value);
          const score = Math.max(0, group.valueUsd - thresholdUsd)
            - Math.max(0, sourceAfter - thresholdUsd)
            - Math.max(0, targetAfter - thresholdUsd);
          if (score > 0 && (!best || score > best.score)) best = { item, candidate, score };
        }
      }
    }

    if (!best) break;
    const index = assigned.findIndex((item) => item === best.item);
    const previousSupplierId = assigned[index].supplierId;
    assigned[index] = { ...assigned[index], ...best.candidate };
    substitutions.push({ productId: assigned[index].id, fromSupplierId: previousSupplierId, toSupplierId: best.candidate.supplierId });
  }

  return { items: assigned, substitutions };
}

function buildImportCompliancePlan(items, options = {}) {
  const thresholdUsd = Number(options.thresholdUsd ?? DEFAULT_THRESHOLD_USD);
  const usdIlsRate = Number(options.usdIlsRate);
  const vatRate = Number(options.vatRate ?? DEFAULT_VAT_RATE);
  if (!Number.isFinite(thresholdUsd) || thresholdUsd <= 0) throw new Error('invalid_import_threshold');
  if (!Number.isFinite(usdIlsRate) || usdIlsRate <= 0) throw new Error('invalid_usd_ils_rate');
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1) throw new Error('invalid_import_vat_rate');

  const { items: assignedItems, substitutions } = chooseVerifiedAlternatives(items, thresholdUsd, usdIlsRate);
  const groups = groupItems(assignedItems, usdIlsRate).map((group) => {
    const exceedsThreshold = group.valueUsd > thresholdUsd;
    const estimatedTaxIls = exceedsThreshold ? money(group.valueUsd * usdIlsRate * vatRate) : 0;
    return {
      supplierId: group.supplierId,
      itemIds: group.items.map((item) => String(item.id)),
      valueUsd: group.valueUsd,
      exceedsThreshold,
      estimatedTaxIls,
      fulfillmentMode: 'single_real_supplier_order'
    };
  });
  const estimatedTaxIls = money(groups.reduce((sum, group) => sum + group.estimatedTaxIls, 0));

  return {
    version: 1,
    thresholdUsd,
    usdIlsRate,
    vatRate,
    strategy: estimatedTaxIls > 0 ? 'supplier_orders_with_tax_fallback' : 'real_orders_by_supplier',
    substitutions,
    groups,
    estimatedTaxIls,
    taxEstimateOnly: estimatedTaxIls > 0,
    complianceNotice: estimatedTaxIls > 0
      ? 'לא נמצא פיצול חוקי מלא בין ספקים מאומתים. המס הוא אומדן בלבד ויחושב סופית בידי הרשויות.'
      : 'הפריטים יקובצו להזמנות אמיתיות לפי ספק. ערכי המוצרים נשמרים ללא שינוי.',
    assignedItems
  };
}

module.exports = {
  DEFAULT_THRESHOLD_USD,
  DEFAULT_VAT_RATE,
  buildImportCompliancePlan,
  groupItems,
  normalizeAlternative
};

