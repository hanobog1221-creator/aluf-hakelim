const { requireAdmin, config, dbHeaders, audit } = require('../_lib/admin');
const { summarizeAccounting } = require('../_lib/accounting');

const ORDER_STATUSES = new Set(['draft','payment_pending','paid','processing','ordered','shipped','completed','cancelled','error']);
const FULFILLMENT_STATUSES = new Set(['not_started','waiting','ready','ordering','ordered','shipped','delivered','failed','cancelled']);
const REFUND_STATUSES = new Set(['none','requested','approved','rejected','processing','partial','refunded']);
const EXPENSE_CATEGORIES = new Set(['supplier_purchase','shipping','payment_fee','advertising','software','refund','bank_fee','other']);

function text(value, max) {
  if (value === null || value === undefined || value === '') return null;
  const out = String(value).trim();
  if (out.length > max) throw new Error('text_too_long');
  return out || null;
}

function safeSupplierPaymentUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !/(^|\.)cjdropshipping\.com$/i.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function paymentUrlFromAttempt(attempt) {
  const created = Array.isArray(attempt?.response?.created) ? attempt.response.created : [];
  return created.map((row) => safeSupplierPaymentUrl(row?.paymentUrl)).find(Boolean) || null;
}

function validYear(value) {
  const year = Number(value || new Date().getUTCFullYear());
  return Number.isInteger(year) && year >= 2020 && year <= 2100 ? year : null;
}

function expenseSummary(expenses) {
  const summary = {
    count: expenses.length,
    total: 0,
    supplierPurchases: 0,
    shipping: 0,
    paymentFees: 0,
    advertising: 0,
    software: 0,
    refunds: 0,
    bankFees: 0,
    other: 0
  };
  for (const expense of expenses) {
    const amount = Number(expense.amount || 0);
    summary.total += amount;
    if (expense.category === 'supplier_purchase') summary.supplierPurchases += amount;
    else if (expense.category === 'shipping') summary.shipping += amount;
    else if (expense.category === 'payment_fee') summary.paymentFees += amount;
    else if (expense.category === 'advertising') summary.advertising += amount;
    else if (expense.category === 'software') summary.software += amount;
    else if (expense.category === 'refund') summary.refunds += amount;
    else if (expense.category === 'bank_fee') summary.bankFees += amount;
    else summary.other += amount;
  }
  for (const key of Object.keys(summary)) {
    if (key !== 'count') summary[key] = Number(Number(summary[key]).toFixed(2));
  }
  return summary;
}

async function readExpensesForYear(supabaseUrl, year) {
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  const response = await fetch(
    `${supabaseUrl}/rest/v1/business_expenses?expense_date=gte.${start}&expense_date=lt.${end}&select=*&order=expense_date.desc,created_at.desc&limit=5000`,
    { headers: dbHeaders() }
  );
  if (!response.ok) throw new Error(`expenses_read_${response.status}`);
  return response.json();
}

async function writeOrderEvent(supabaseUrl, orderId, eventType, payload = {}) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/order_events`, {
      method: 'POST',
      headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ order_id: orderId, event_type: eventType, payload })
    });
  } catch (error) {
    console.error('order event write failed', error);
  }
}

function accountingDate(order) {
  return order.paid_at || order.created_at || null;
}

function parseRefundDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid_refund_date');
  return date.toISOString();
}

async function loadOrder(supabaseUrl, orderId) {
  const response = await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`, {
    headers: dbHeaders()
  });
  if (!response.ok) throw new Error(`order_read_${response.status}`);
  return (await response.json())[0] || null;
}

function buildRefundUpdate(body, current) {
  const wantsRefund = ['refund_status','refund_amount','refunded_at'].some((key) => Object.prototype.hasOwnProperty.call(body, key));
  if (!wantsRefund) return null;

  const nextStatus = Object.prototype.hasOwnProperty.call(body, 'refund_status')
    ? String(body.refund_status || 'none')
    : String(current.refund_status || 'none');
  if (!REFUND_STATUSES.has(nextStatus)) throw new Error('invalid_refund_status');

  const paidTotal = Number((Number(current.total || 0) + Number(current.shipping_cost || 0)).toFixed(2));
  const nextAmount = Object.prototype.hasOwnProperty.call(body, 'refund_amount')
    ? Number(body.refund_amount)
    : Number(current.refund_amount || 0);
  if (!Number.isFinite(nextAmount) || nextAmount < 0 || nextAmount > paidTotal) throw new Error('invalid_refund_amount');

  const completed = nextStatus === 'partial' || nextStatus === 'refunded';
  if (completed && (!current.paid_at || !['paid','refunded'].includes(String(current.payment_status || '')))) {
    throw new Error('refund_requires_paid_order');
  }
  if (nextStatus === 'partial' && (nextAmount <= 0 || nextAmount >= paidTotal)) throw new Error('invalid_partial_refund_amount');
  if (nextStatus === 'refunded' && (paidTotal <= 0 || Number(nextAmount.toFixed(2)) !== paidTotal)) {
    throw new Error('invalid_full_refund_amount');
  }
  if (['requested','approved','rejected','processing'].includes(nextStatus) && current.payment_status === 'refunded') {
    throw new Error('completed_refund_cannot_reopen');
  }

  const update = {
    refund_status: nextStatus,
    refund_amount: Number(nextAmount.toFixed(2))
  };

  if (nextStatus === 'none') {
    update.refund_amount = 0;
    update.refunded_at = null;
    if (current.paid_at && current.payment_status === 'refunded') update.payment_status = 'paid';
  } else if (nextStatus === 'partial') {
    update.payment_status = 'paid';
    if (Object.prototype.hasOwnProperty.call(body, 'refunded_at')) update.refunded_at = parseRefundDate(body.refunded_at);
  } else if (nextStatus === 'refunded') {
    update.payment_status = 'refunded';
    if (Object.prototype.hasOwnProperty.call(body, 'refunded_at')) update.refunded_at = parseRefundDate(body.refunded_at);
  } else {
    update.refunded_at = null;
  }

  return update;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!await requireAdmin(req, res)) return;

  try {
    const { supabaseUrl } = config();

    if (req.method === 'GET') {
      const accounting = String(req.query?.accounting || '') === '1';
      const expensesOnly = String(req.query?.expenses || '') === '1';

      if (accounting || expensesOnly) {
        const year = validYear(req.query?.year);
        if (!year) return res.status(400).json({ ok: false, error: 'invalid_year' });

        const expenses = await readExpensesForYear(supabaseUrl, year);
        const expensesSummary = expenseSummary(expenses);

        if (expensesOnly) {
          return res.status(200).json({ ok: true, expenses: true, year, items: expenses, summary: expensesSummary });
        }

        const response = await fetch(`${supabaseUrl}/rest/v1/orders?paid_at=not.is.null&select=*&order=created_at.asc&limit=5000`, {
          headers: dbHeaders()
        });
        if (!response.ok) throw new Error(`accounting_orders_read_${response.status}`);
        const allPaid = await response.json();
        const orders = allPaid.filter((order) => {
          const date = accountingDate(order);
          if (!date) return false;
          const d = new Date(date);
          return Number.isFinite(d.getTime()) && d.getUTCFullYear() === year;
        });
        const summary = summarizeAccounting(orders, expensesSummary);
        return res.status(200).json({ ok: true, accounting: true, year, orders, summary, expenses, expensesSummary });
      }

      const limitRaw = Number(req.query?.limit || 100);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 100;
      const response = await fetch(`${supabaseUrl}/rest/v1/orders?select=*&order=created_at.desc&limit=${limit}`, {
        headers: dbHeaders()
      });
      if (!response.ok) throw new Error(`orders_read_${response.status}`);
      const orders = await response.json();
      const orderIds = orders.map((order) => String(order.order_id || '')).filter(Boolean);
      let attempts = [];
      if (orderIds.length) {
        const filter = orderIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
        const attemptsResponse = await fetch(`${supabaseUrl}/rest/v1/supplier_order_attempts?order_id=in.(${encodeURIComponent(filter)})&status=eq.payment_pending&select=order_id,provider,response,updated_at&order=updated_at.desc`, { headers: dbHeaders() });
        if (attemptsResponse.ok) attempts = await attemptsResponse.json();
      }
      const attemptByOrder = new Map();
      for (const attempt of attempts) if (!attemptByOrder.has(String(attempt.order_id))) attemptByOrder.set(String(attempt.order_id), attempt);
      const enriched = orders.map((order) => {
        const attempt = attemptByOrder.get(String(order.order_id));
        const directUrl = paymentUrlFromAttempt(attempt);
        const provider = String(attempt?.provider || '').toLowerCase();
        return {
          ...order,
          supplier_payment_url: directUrl || (provider === 'aliexpress' ? 'https://www.aliexpress.com/p/order/index.html' : null),
          supplier_payment_provider: directUrl ? 'cj' : (provider === 'aliexpress' ? 'aliexpress' : null)
        };
      });
      return res.status(200).json({ ok: true, orders: enriched });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (body.action !== 'expense_create') return res.status(400).json({ ok: false, error: 'invalid_action' });

      const category = String(body.category || 'other').trim();
      if (!EXPENSE_CATEGORIES.has(category)) return res.status(400).json({ ok: false, error: 'invalid_expense_category' });
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return res.status(400).json({ ok: false, error: 'invalid_expense_amount' });
      const description = text(body.description, 240);
      if (!description) return res.status(400).json({ ok: false, error: 'expense_description_required' });

      const rawDate = String(body.expense_date || '').trim();
      const expenseDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);
      if (!Number.isFinite(Date.parse(`${expenseDate}T00:00:00Z`))) return res.status(400).json({ ok: false, error: 'invalid_expense_date' });

      const row = {
        expense_date: expenseDate,
        category,
        description,
        amount: Number(amount.toFixed(2)),
        currency: 'ILS',
        reference: text(body.reference, 160),
        order_id: text(body.order_id, 80),
        source: 'manual',
        source_key: null,
        updated_at: new Date().toISOString()
      };

      const response = await fetch(`${supabaseUrl}/rest/v1/business_expenses`, {
        method: 'POST',
        headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify(row)
      });
      if (!response.ok) {
        const details = await response.text();
        throw new Error(`expense_create_${response.status}_${details.slice(0, 200)}`);
      }
      const expense = (await response.json())[0] || row;
      await audit('expense_create', 'business_expense', String(expense.id || ''), {
        category: expense.category,
        amount: expense.amount,
        order_id: expense.order_id || null
      });
      return res.status(201).json({ ok: true, expense });
    }

    if (req.method === 'DELETE') {
      const expenseId = Number(req.query?.expenseId || 0);
      if (!Number.isInteger(expenseId) || expenseId <= 0) return res.status(400).json({ ok: false, error: 'invalid_expense_id' });
      const response = await fetch(`${supabaseUrl}/rest/v1/business_expenses?id=eq.${expenseId}&source=eq.manual`, {
        method: 'DELETE',
        headers: dbHeaders({ Prefer: 'return=representation' })
      });
      if (!response.ok) throw new Error(`expense_delete_${response.status}`);
      const deleted = await response.json();
      if (!deleted.length) return res.status(404).json({ ok: false, error: 'expense_not_found_or_locked' });
      await audit('expense_delete', 'business_expense', String(expenseId), { category: deleted[0].category, amount: deleted[0].amount });
      return res.status(200).json({ ok: true, deleted: true });
    }

    if (req.method === 'PATCH') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const orderId = String(body.order_id || '').trim();
      if (!/^AH-[A-Z0-9-]{5,60}$/.test(orderId)) return res.status(400).json({ ok: false, error: 'invalid_order_id' });

      const current = await loadOrder(supabaseUrl, orderId);
      if (!current) return res.status(404).json({ ok: false, error: 'order_not_found' });

      const update = {};
      if ('status' in body) {
        const status = String(body.status || '');
        if (!ORDER_STATUSES.has(status)) return res.status(400).json({ ok: false, error: 'invalid_status' });
        update.status = status;
      }
      if ('fulfillment_status' in body) {
        const status = String(body.fulfillment_status || '');
        if (!FULFILLMENT_STATUSES.has(status)) return res.status(400).json({ ok: false, error: 'invalid_fulfillment_status' });
        update.fulfillment_status = status;
      }
      if ('supplier_order_id' in body) update.supplier_order_id = text(body.supplier_order_id, 120);
      if ('tracking_number' in body) update.tracking_number = text(body.tracking_number, 160);
      if ('last_error' in body) update.last_error = text(body.last_error, 1200);
      if ('admin_note' in body) update.admin_note = text(body.admin_note, 2000);
      if ('customer_note' in body) update.customer_note = text(body.customer_note, 800);

      const refundUpdate = buildRefundUpdate(body, current);
      if (refundUpdate) Object.assign(update, refundUpdate);

      if (!Object.keys(update).length) return res.status(400).json({ ok: false, error: 'no_changes' });
      update.updated_at = new Date().toISOString();

      const response = await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify(update)
      });
      if (!response.ok) {
        const details = await response.text();
        if (/refund|completed_refund/i.test(details)) return res.status(400).json({ ok: false, error: 'invalid_refund_update' });
        throw new Error(`order_update_${response.status}_${details.slice(0, 200)}`);
      }
      const order = (await response.json())[0] || null;
      if (!order) return res.status(404).json({ ok: false, error: 'order_not_found' });

      const changedFields = Object.keys(update).filter((key) => key !== 'updated_at');
      await audit(refundUpdate ? 'order_refund_record_update' : 'order_update', 'order', orderId, {
        fields: changedFields,
        refund_status: refundUpdate ? order.refund_status : undefined,
        refund_amount: refundUpdate ? order.refund_amount : undefined
      });
      await writeOrderEvent(supabaseUrl, orderId, refundUpdate ? 'admin_refund_record_update' : 'admin_order_update', {
        fields: changedFields,
        status: order.status,
        fulfillmentStatus: order.fulfillment_status,
        refundStatus: order.refund_status,
        refundAmount: Number(order.refund_amount || 0),
        hasTracking: Boolean(order.tracking_number),
        hasCustomerNote: Boolean(order.customer_note)
      });
      return res.status(200).json({ ok: true, order });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (error) {
    const message = String(error.message || error);
    console.error('admin orders error', error);
    if (message.includes('invalid_refund_status')) return res.status(400).json({ ok: false, error: 'invalid_refund_status' });
    if (message.includes('invalid_refund_amount')) return res.status(400).json({ ok: false, error: 'invalid_refund_amount' });
    if (message.includes('invalid_partial_refund_amount')) return res.status(400).json({ ok: false, error: 'invalid_partial_refund_amount' });
    if (message.includes('invalid_full_refund_amount')) return res.status(400).json({ ok: false, error: 'invalid_full_refund_amount' });
    if (message.includes('refund_requires_paid_order')) return res.status(400).json({ ok: false, error: 'refund_requires_paid_order' });
    if (message.includes('completed_refund_cannot_reopen')) return res.status(400).json({ ok: false, error: 'completed_refund_cannot_reopen' });
    if (message.includes('invalid_refund_date')) return res.status(400).json({ ok: false, error: 'invalid_refund_date' });
    return res.status(500).json({ ok: false, error: 'admin_orders_failed' });
  }
};
