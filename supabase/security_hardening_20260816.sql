-- Security hardening applied to the production Supabase project on 2026-08-16.
-- This file exists so the production database protections are reproducible.

-- Internal views run with the caller's privileges, not their owner's privileges.
alter view public.product_fulfillment_readiness set (security_invoker = true);
alter view public.open_supplier_alerts set (security_invoker = true);

revoke all on public.product_fulfillment_readiness from public, anon, authenticated;
revoke all on public.open_supplier_alerts from public, anon, authenticated;
grant select on public.product_fulfillment_readiness to service_role;
grant select on public.open_supplier_alerts to service_role;

-- Internal/trigger helper functions must not be callable through the public RPC surface.
revoke execute on function public.log_order_created_event() from public, anon, authenticated;
revoke execute on function public.log_order_status_changes() from public, anon, authenticated;
revoke execute on function public.log_product_changes() from public, anon, authenticated;
revoke execute on function public.process_supplier_sync_alerts() from public, anon, authenticated;
revoke execute on function public.raise_supplier_alert(text,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.record_coupon_redemption() from public, anon, authenticated;
revoke execute on function public.sync_order_payment_fee_expense() from public, anon, authenticated;
revoke execute on function public.sync_supplier_order_expense() from public, anon, authenticated;
revoke execute on function public.touch_return_request_updated_at() from public, anon, authenticated;
revoke execute on function public.guard_product_fulfillment_readiness() from public, anon, authenticated;

alter function public.touch_return_request_updated_at() set search_path = public, pg_temp;
alter function public.guard_product_fulfillment_readiness() set search_path = public, pg_temp;

-- Prevent a reconnect flow from silently replacing the linked AliExpress account identity.
create or replace function public.guard_aliexpress_token_identity()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if old.account_key <> new.account_key then
      raise exception 'aliexpress_account_key_change_blocked';
    end if;
    if old.user_id is not null and new.user_id is distinct from old.user_id then
      raise exception 'aliexpress_account_identity_change_blocked';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_aliexpress_token_identity() from public, anon, authenticated;
drop trigger if exists aliexpress_token_identity_guard on public.aliexpress_tokens;
create trigger aliexpress_token_identity_guard
before update on public.aliexpress_tokens
for each row execute function public.guard_aliexpress_token_identity();

-- Remove duplicate indexes only; other currently-unused indexes are intentionally retained.
drop index if exists public.business_expenses_source_key_unique_idx;
drop index if exists public.order_events_order_created_idx;

-- No browser/client role needs direct table access except the two storefront-read tables below.
do $$
declare r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename not in ('products','site_settings')
  loop
    execute format('revoke all privileges on table public.%I from anon, authenticated', r.tablename);
  end loop;
end $$;

-- Public storefront roles can read only customer-facing product columns.
revoke all privileges on table public.products from anon, authenticated;
grant select (
  id,
  name,
  selling_price,
  old_price,
  currency,
  image_url,
  active,
  categories,
  kind,
  badge,
  badge_class,
  description,
  specs,
  sort_order,
  max_order_quantity,
  supplier_in_stock,
  supplier_shipping,
  supplier_shipping_available,
  shipping_currency,
  shipping_last_checked_at
) on table public.products to anon, authenticated;

-- Public storefront roles can read only customer-facing contact settings.
revoke all privileges on table public.site_settings from anon, authenticated;
grant select (
  id,
  whatsapp_enabled,
  whatsapp_number,
  whatsapp_message,
  support_email,
  support_hours
) on table public.site_settings to anon, authenticated;
