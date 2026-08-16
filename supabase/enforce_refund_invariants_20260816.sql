-- Applied to production on 2026-08-16.
-- Refunds cannot exceed the paid total; partial/full completion states are normalized and validated.

alter table public.orders
  drop constraint if exists orders_refund_not_above_paid_total;

alter table public.orders
  add constraint orders_refund_not_above_paid_total
  check (refund_amount <= round(coalesce(total,0) + coalesce(shipping_cost,0), 2));

create or replace function public.normalize_order_refund_state()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_paid_total numeric;
begin
  v_paid_total := round(coalesce(new.total,0) + coalesce(new.shipping_cost,0), 2);

  if coalesce(new.refund_amount,0) < 0 or coalesce(new.refund_amount,0) > v_paid_total then
    raise exception 'refund_amount_out_of_range' using errcode='23514';
  end if;

  if coalesce(new.refund_status,'none') = 'none' then
    new.refund_amount := 0;
    new.refunded_at := null;
    return new;
  end if;

  if new.refund_status = 'partial' then
    if new.payment_status not in ('paid','refunded') then
      raise exception 'completed_refund_requires_paid_order' using errcode='23514';
    end if;
    if coalesce(new.refund_amount,0) <= 0 or new.refund_amount >= v_paid_total then
      raise exception 'partial_refund_amount_invalid' using errcode='23514';
    end if;
    new.refunded_at := coalesce(new.refunded_at, now());
  elsif new.refund_status = 'refunded' then
    if new.payment_status not in ('paid','refunded') then
      raise exception 'completed_refund_requires_paid_order' using errcode='23514';
    end if;
    if v_paid_total <= 0 or round(coalesce(new.refund_amount,0),2) <> v_paid_total then
      raise exception 'full_refund_must_equal_paid_total' using errcode='23514';
    end if;
    new.refunded_at := coalesce(new.refunded_at, now());
    new.payment_status := 'refunded';
  end if;

  return new;
end;
$function$;

drop trigger if exists orders_refund_state_normalize on public.orders;
create trigger orders_refund_state_normalize
before insert or update of refund_status, refund_amount, refunded_at on public.orders
for each row execute function public.normalize_order_refund_state();

revoke all on function public.normalize_order_refund_state() from public, anon, authenticated;
grant execute on function public.normalize_order_refund_state() to service_role;
