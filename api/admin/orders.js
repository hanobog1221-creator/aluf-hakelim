const { requireAdmin, config, dbHeaders, audit } = require('../_lib/admin');
const { summarizeAccounting } = require('../_lib/accounting');

const ORDER_STATUSES = new Set(['draft','payment_pending','paid','processing','ordered','shipped','completed','cancelled','error']);
const FULFILLMENT_STATUSES = new Set(['not_started','waiting','ready','ordering','ordered','shipped','delivered','failed','cancelled']);
const EXPENSE_CATEGORIES = new Set(['supplier_purchase','shipping','payment_fee','advertising','software','refund','bank_fee','other']);

function text(value, max) {
  if (value === null || value === undefined || value === '') return null;
  const out = String(value).trim();
  if (out.length > max) throw new Error('text_too_long');
  return out || null;
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

        // A refunded order was still originally paid, so accounting is based on paid_at rather than current payment_status.
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
      return res.status(200).json({ ok: true, orders });
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

      if (!Object.keys(update).length) return res.status(400).json({ ok: false, error: 'no_changes' });
      update.updated_at = new Date().toISOString();

      const response = await fetch(`${supabaseUrl}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify(update)
      });
      if (!response.ok) {
        const details = await response.text();
        throw new Error(`order_update_${response.status}_${details.slice(0, 200)}`);
      }
      const order = (await response.json())[0] || null;
      if (!order) return res.status(404).json({ ok: false, error: 'order_not_found' });

      const changedFields = Object.keys(update).filter((key) => key !== 'updated_at');
      await audit('order_update', 'order', orderId, { fields: changedFields });
      await writeOrderEvent(supabaseUrl, orderId, 'admin_order_update', {
        fields: changedFields,
        status: order.status,
        fulfillmentStatus: order.fulfillment_status,
        hasTracking: Boolean(order.tracking_number),
        hasCustomerNote: Boolean(order.customer_note)
      });
      return res.status(200).json({ ok: true, order });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (error) {
    console.error('admin orders error', error);
    return res.status(500).json({ ok: false, error: 'admin_orders_failed' });
  }
};
