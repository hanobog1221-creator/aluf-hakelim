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

-- Remove duplicate indexes only; other currently-unused indexes are intentionally retained.
drop index if exists public.business_expenses_source_key_unique_idx;
drop index if exists public.order_events_order_created_idx;

-- Public storefront roles can read only customer-facing product columns.
revoke select on table public.products from anon, authenticated;
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
revoke select on table public.site_settings from anon, authenticated;
grant select (
  id,
  whatsapp_enabled,
  whatsapp_number,
  whatsapp_message,
  support_email,
  support_hours
) on table public.site_settings to anon, authenticated;
