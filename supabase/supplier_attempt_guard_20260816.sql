-- Supplier order attempt transition guard applied to production on 2026-08-16.
-- Prevents accidental/unsafe mutation of supplier-order attempt identity and status.

create or replace function public.guard_supplier_order_attempt_transition()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  element jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.order_id is distinct from old.order_id
       or new.attempt_key is distinct from old.attempt_key
       or new.request_fingerprint is distinct from old.request_fingerprint then
      raise exception 'supplier_attempt_identity_immutable';
    end if;

    if new.status is distinct from old.status then
      if not (
        (old.status = 'prepared' and new.status in ('sending','cancelled','failed')) or
        (old.status = 'sending' and new.status in ('created','payment_pending','paid','ambiguous','failed')) or
        (old.status = 'created' and new.status in ('payment_pending','paid','ambiguous','failed','reconciled')) or
        (old.status = 'payment_pending' and new.status in ('paid','ambiguous','failed','reconciled')) or
        (old.status = 'ambiguous' and new.status in ('created','payment_pending','paid','failed','reconciled')) or
        (old.status = 'failed' and new.status = 'reconciled')
      ) then
        raise exception 'invalid_supplier_attempt_transition_%_to_%', old.status, new.status;
      end if;
    end if;

    if jsonb_typeof(old.supplier_order_ids) = 'array'
       and jsonb_array_length(old.supplier_order_ids) > 0
       and exists (
         select 1
         from jsonb_array_elements_text(old.supplier_order_ids) as x(id)
         where not (new.supplier_order_ids ? x.id)
       ) then
      raise exception 'supplier_order_ids_cannot_be_removed';
    end if;
  end if;

  if jsonb_typeof(new.supplier_order_ids) <> 'array' then
    raise exception 'supplier_order_ids_must_be_array';
  end if;

  for element in select value from jsonb_array_elements(new.supplier_order_ids)
  loop
    if jsonb_typeof(element) <> 'string'
       or trim(both '"' from element::text) !~ '^\d{5,30}$' then
      raise exception 'invalid_supplier_order_id';
    end if;
  end loop;

  if new.status in ('created','payment_pending','paid','reconciled')
     and jsonb_array_length(new.supplier_order_ids) = 0 then
    raise exception 'supplier_order_ids_required_for_status_%', new.status;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_supplier_order_attempt_transition() from public, anon, authenticated;

drop trigger if exists supplier_order_attempt_transition_guard on public.supplier_order_attempts;
create trigger supplier_order_attempt_transition_guard
before insert or update on public.supplier_order_attempts
for each row execute function public.guard_supplier_order_attempt_transition();
