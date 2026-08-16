-- Applied to production on 2026-08-16.
-- Completed refunds are mirrored into business_expenses exactly once per order.

create or replace function public.sync_order_refund_expense()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_amount numeric;
  v_source_key text;
  v_completed boolean;
begin
  v_amount := greatest(coalesce(new.refund_amount, 0), 0);
  v_source_key := 'refund:' || new.order_id;
  v_completed := (coalesce(new.refund_status,'none') in ('partial','refunded') or new.refunded_at is not null);

  if v_completed and v_amount > 0 then
    insert into public.business_expenses(
      expense_date,
      category,
      description,
      amount,
      currency,
      reference,
      order_id,
      source,
      source_key,
      updated_at
    ) values (
      coalesce(new.refunded_at, new.updated_at, now())::date,
      'refund',
      'החזר ללקוח עבור הזמנה ' || new.order_id,
      round(v_amount, 2),
      coalesce(new.currency, 'ILS'),
      new.payment_reference,
      new.order_id,
      'refund',
      v_source_key,
      now()
    )
    on conflict (source, source_key) where source_key is not null
    do update set
      expense_date = excluded.expense_date,
      amount = excluded.amount,
      currency = excluded.currency,
      reference = excluded.reference,
      description = excluded.description,
      updated_at = now();
  else
    delete from public.business_expenses
    where source = 'refund'
      and source_key = v_source_key;
  end if;

  return new;
end;
$function$;

drop trigger if exists orders_refund_expense_sync on public.orders;
create trigger orders_refund_expense_sync
after insert or update of refund_status, refund_amount, refunded_at on public.orders
for each row execute function public.sync_order_refund_expense();

revoke all on function public.sync_order_refund_expense() from public, anon, authenticated;
grant execute on function public.sync_order_refund_expense() to service_role;
