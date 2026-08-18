const crypto = require('crypto');
const { getFulfillmentCandidate } = require('./fulfillment');
const { quoteCartShipping } = require('./shipping');
const { buildPlaceOrderRequests, safePreview, parsePlaceOrderResponse } = require('./aliexpress-order');
const { callTopApi } = require('./aliexpress');
const { serverConfig, serverHeaders } = require('./supabase-server');

const PLACE_ORDER_METHOD = 'aliexpress.trade.buy.placeorder';
const PLACE_ORDER_PARAM = 'param_place_order_request4_open_api_d_t_o';
const OPEN_ATTEMPT_STATUSES = 'sending,created,payment_pending,paid,ambiguous';

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function aliExpressCreateEnabled() {
  // Safe default: order creation runs only after the customer payment is confirmed,
  // fulfillment validation passes, and a fresh supplier shipping quote is covered.
  // Set ALIEXPRESS_ORDER_CREATE_ENABLED=false as an emergency kill switch.
  return boolEnv('ALIEXPRESS_ORDER_CREATE_ENABLED', true);
}

function aliExpressAutoPayAuthorized() {
  // Never assume supplier auto-pay. This may only be enabled after the linked
  // AliExpress account has an externally verified automatic-payment arrangement.
  return boolEnv('ALIEXPRESS_AUTO_PAY_AUTHORIZED', false);
}

function aliExpressLiveAutomationReady() {
  return aliExpressCreateEnabled();
}

function fingerprintGroups(groups) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(groups.map((group) => group.request)), 'utf8')
    .digest('hex');
}

async function dbJson(path, options = {}) {
  const { supabaseUrl, serviceKey } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: serverHeaders(options.headers || {}, serviceKey)
  });
  const raw = await response.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const error = new Error(`aliexpress_fulfillment_db_${response.status}`);
    error.details = raw.slice(0, 300);
    throw error;
  }
  return json;
}

async function findOpenAttempt(orderId) {
  const rows = await dbJson(
    `supplier_order_attempts?order_id=eq.${encodeURIComponent(orderId)}&provider=eq.aliexpress&status=in.(${OPEN_ATTEMPT_STATUSES})&select=*&order=created_at.desc&limit=1`
  );
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

async function createSendingAttempt(orderId, requestFingerprint) {
  try {
    const rows = await dbJson('supplier_order_attempts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        order_id: orderId,
        request_fingerprint: requestFingerprint,
        status: 'sending',
        provider: 'aliexpress',
        provider_payment_required: true,
        provider_payment_completed: false,
        provider_sandbox: false,
        supplier_order_ids: []
      })
    });
    return Array.isArray(rows) ? (rows[0] || null) : null;
  } catch (error) {
    // A concurrent request may have won the unique open-attempt race.
    const existing = await findOpenAttempt(orderId).catch(() => null);
    if (existing) return existing;
    throw error;
  }
}

async function patchAttempt(id, patch) {
  const rows = await dbJson(`supplier_order_attempts?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

async function patchOrder(orderId, supplierOrderIds, lastError) {
  const ids = [...new Set((Array.isArray(supplierOrderIds) ? supplierOrderIds : [])
    .map((value) => String(value || '').trim())
    .filter((value) => /^\d{5,30}$/.test(value)))];
  const patch = {
    status: 'processing',
    fulfillment_status: 'waiting',
    last_error: lastError || null,
    updated_at: new Date().toISOString()
  };
  if (ids.length) {
    patch.supplier_order_id = ids[0];
    patch.supplier_order_ids = ids;
  }
  const rows = await dbJson(`orders?order_id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error('aliexpress_order_state_not_updated');
  return rows[0];
}

async function prepareAliExpressOrder(orderId) {
  const { order, validation } = await getFulfillmentCandidate(orderId);
  if (!validation.ok) {
    return { ok: false, skipped: true, validation, reason: validation.reason, liveSupplierRequestSent: false };
  }

  const nonAliExpress = (Array.isArray(order.items) ? order.items : [])
    .find((item) => String(item?.supplier || '').trim().toLowerCase() !== 'aliexpress');
  if (nonAliExpress) {
    return { ok: false, skipped: true, reason: 'mixed_or_non_aliexpress_order', liveSupplierRequestSent: false };
  }

  const shippingLines = order.items.map((item) => ({
    id: String(item.id || ''),
    qty: Number(item.qty || 0),
    supplier: 'aliexpress',
    supplierProductId: item.supplierProductId,
    supplierSkuId: item.supplierSkuId,
    supplierShipFromCountry: item.supplierShipFromCountry || 'CN'
  }));
  const freshShipping = await quoteCartShipping(shippingLines, 'IL');
  const chargedShipping = Number(order.shipping_cost || 0);
  const currentShipping = Number(freshShipping.total || 0);
  if (!Number.isFinite(currentShipping) || currentShipping > chargedShipping + 0.01) {
    return {
      ok: false,
      skipped: true,
      reason: 'supplier_shipping_price_increased',
      chargedShipping,
      currentShipping: Number.isFinite(currentShipping) ? currentShipping : null,
      liveSupplierRequestSent: false
    };
  }

  const groups = buildPlaceOrderRequests(order, freshShipping);
  return {
    ok: true,
    order,
    groups,
    freshShipping,
    requestFingerprint: fingerprintGroups(groups),
    chargedShipping,
    currentShipping
  };
}

async function preflightAliExpressOrder(orderId) {
  const prepared = await prepareAliExpressOrder(orderId);
  if (!prepared.ok) return prepared;
  const createEnabled = aliExpressCreateEnabled();
  return {
    ok: createEnabled,
    skipped: !createEnabled,
    manualFulfillmentEligible: !createEnabled,
    reason: createEnabled ? 'ready_to_create_supplier_order' : 'aliexpress_order_creation_disabled',
    provider: 'aliexpress',
    requestFingerprint: prepared.requestFingerprint,
    chargedShipping: prepared.chargedShipping,
    currentShipping: prepared.currentShipping,
    supplierOrders: prepared.groups.map((group) => ({ supplierId: group.supplierId, preview: safePreview(group.request) })),
    liveSupplierRequestSent: false,
    supplierPaymentSent: false
  };
}

async function resolveExistingAttempt(orderId, existing) {
  const ids = Array.isArray(existing?.supplier_order_ids) ? existing.supplier_order_ids : [];
  if (ids.length) {
    await patchOrder(orderId, ids, existing.status === 'paid' ? null : 'supplier_payment_confirmation_pending');
    return {
      ok: true,
      skipped: true,
      reason: 'supplier_attempt_already_exists',
      provider: 'aliexpress',
      supplierOrderIds: ids,
      supplierPaymentPending: existing.status !== 'paid',
      liveSupplierRequestSent: true,
      supplierPaymentSent: existing.provider_payment_completed === true
    };
  }

  if (existing?.status === 'sending') {
    const ambiguous = await patchAttempt(existing.id, {
      status: 'ambiguous',
      error_code: 'previous_request_outcome_unknown',
      error_message: 'A previous live supplier request started without a confirmed response. Automatic retry is blocked.'
    }).catch(() => existing);
    await patchOrder(orderId, [], 'supplier_order_outcome_requires_reconciliation').catch(() => {});
    return {
      ok: false,
      skipped: true,
      reason: 'supplier_order_outcome_requires_reconciliation',
      provider: 'aliexpress',
      attemptId: ambiguous?.id || existing.id,
      supplierOrderIds: [],
      manualFulfillmentEligible: false,
      liveSupplierRequestSent: true,
      supplierPaymentSent: false
    };
  }

  return {
    ok: false,
    skipped: true,
    reason: 'supplier_attempt_already_open',
    provider: 'aliexpress',
    attemptId: existing?.id || null,
    supplierOrderIds: ids,
    manualFulfillmentEligible: false,
    liveSupplierRequestSent: true,
    supplierPaymentSent: false
  };
}

async function fulfillAliExpressOrder(orderId) {
  const prepared = await prepareAliExpressOrder(orderId);
  if (!prepared.ok) return { ...prepared, manualFulfillmentEligible: prepared.liveSupplierRequestSent !== true };

  if (!aliExpressCreateEnabled()) {
    return {
      ok: false,
      skipped: true,
      reason: 'aliexpress_order_creation_disabled',
      provider: 'aliexpress',
      manualFulfillmentEligible: true,
      requestFingerprint: prepared.requestFingerprint,
      liveSupplierRequestSent: false,
      supplierPaymentSent: false
    };
  }

  const existing = await findOpenAttempt(orderId);
  if (existing) return resolveExistingAttempt(orderId, existing);

  const attempt = await createSendingAttempt(orderId, prepared.requestFingerprint);
  if (!attempt) throw new Error('supplier_attempt_not_created');
  if (attempt.request_fingerprint !== prepared.requestFingerprint || attempt.status !== 'sending') {
    return resolveExistingAttempt(orderId, attempt);
  }

  const supplierOrderIds = [];
  const journal = [];
  let requestSent = false;

  for (const group of prepared.groups) {
    let json;
    try {
      requestSent = true;
      json = await callTopApi(PLACE_ORDER_METHOD, {
        [PLACE_ORDER_PARAM]: JSON.stringify(group.request)
      });
    } catch (error) {
      const code = String(error.code || error.message || 'supplier_request_failed').slice(0, 120);
      const message = String(error.details || error.message || error).slice(0, 500);
      journal.push({ supplierId: group.supplierId, outcome: 'unknown', errorCode: code, errorMessage: message });
      await patchAttempt(attempt.id, {
        status: 'ambiguous',
        supplier_order_ids: supplierOrderIds,
        error_code: code,
        error_message: message,
        response: journal
      });
      await patchOrder(orderId, supplierOrderIds, 'supplier_order_outcome_requires_reconciliation');
      return {
        ok: false,
        reason: 'supplier_order_outcome_requires_reconciliation',
        provider: 'aliexpress',
        attemptId: attempt.id,
        supplierOrderIds,
        manualFulfillmentEligible: false,
        liveSupplierRequestSent: requestSent,
        supplierPaymentSent: false
      };
    }

    const parsed = parsePlaceOrderResponse(json);
    for (const id of parsed.orderIds || []) if (!supplierOrderIds.includes(id)) supplierOrderIds.push(id);
    journal.push({
      supplierId: group.supplierId,
      outcome: parsed.outcome,
      orderIds: parsed.orderIds || [],
      errorCode: parsed.errorCode || null,
      errorMessage: parsed.errorMessage || null
    });

    if (parsed.outcome === 'created') continue;

    if (parsed.outcome === 'ambiguous' || supplierOrderIds.length) {
      await patchAttempt(attempt.id, {
        status: 'ambiguous',
        supplier_order_ids: supplierOrderIds,
        error_code: parsed.errorCode || 'supplier_order_outcome_unknown',
        error_message: parsed.errorMessage || 'Supplier response requires reconciliation before any retry.',
        response: journal
      });
      await patchOrder(orderId, supplierOrderIds, 'supplier_order_outcome_requires_reconciliation');
      return {
        ok: false,
        reason: 'supplier_order_outcome_requires_reconciliation',
        provider: 'aliexpress',
        attemptId: attempt.id,
        supplierOrderIds,
        manualFulfillmentEligible: false,
        liveSupplierRequestSent: true,
        supplierPaymentSent: false
      };
    }

    await patchAttempt(attempt.id, {
      status: 'failed',
      supplier_order_ids: [],
      error_code: parsed.errorCode || 'place_order_failed',
      error_message: parsed.errorMessage || 'AliExpress rejected the supplier order.',
      response: journal
    });
    return {
      ok: false,
      reason: parsed.errorCode || 'place_order_failed',
      provider: 'aliexpress',
      attemptId: attempt.id,
      supplierOrderIds: [],
      manualFulfillmentEligible: false,
      // A live request reached AliExpress, so a blind manual recreation is unsafe even
      // when the response says failed; an operator can inspect the attempt first.
      liveSupplierRequestSent: true,
      supplierPaymentSent: false
    };
  }

  if (!supplierOrderIds.length) {
    await patchAttempt(attempt.id, {
      status: 'ambiguous',
      error_code: 'supplier_order_ids_missing',
      error_message: 'AliExpress returned no confirmed supplier order IDs.',
      response: journal
    });
    await patchOrder(orderId, [], 'supplier_order_outcome_requires_reconciliation');
    return {
      ok: false,
      reason: 'supplier_order_outcome_requires_reconciliation',
      provider: 'aliexpress',
      attemptId: attempt.id,
      supplierOrderIds: [],
      manualFulfillmentEligible: false,
      liveSupplierRequestSent: true,
      supplierPaymentSent: false
    };
  }

  await patchAttempt(attempt.id, {
    status: 'created',
    supplier_order_ids: supplierOrderIds,
    response: journal,
    error_code: null,
    error_message: null
  });

  const autoPayExpected = aliExpressAutoPayAuthorized();
  await patchAttempt(attempt.id, {
    status: 'payment_pending',
    supplier_order_ids: supplierOrderIds,
    provider_payment_required: true,
    provider_payment_completed: false,
    error_code: null,
    error_message: autoPayExpected ? 'AliExpress auto-pay confirmation pending.' : 'Supplier payment is required.'
  });

  await patchOrder(
    orderId,
    supplierOrderIds,
    autoPayExpected ? 'supplier_autopay_confirmation_pending' : 'manual_supplier_payment_required'
  );

  return {
    ok: true,
    created: true,
    provider: 'aliexpress',
    attemptId: attempt.id,
    supplierOrderIds,
    supplierPaymentPending: true,
    autoPayExpected,
    manualPaymentRequired: !autoPayExpected,
    liveSupplierRequestSent: true,
    supplierPaymentSent: false
  };
}

module.exports = {
  PLACE_ORDER_METHOD,
  PLACE_ORDER_PARAM,
  aliExpressCreateEnabled,
  aliExpressAutoPayAuthorized,
  aliExpressLiveAutomationReady,
  preflightAliExpressOrder,
  fulfillAliExpressOrder
};
