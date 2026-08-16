-- Applied to production on 2026-08-16.
-- These booleans are intentionally customer-facing state used by the storefront.
-- Supplier IDs, SKUs, costs, sync errors and legal/business identity fields remain private.

grant select (sales_enabled) on table public.site_settings to anon, authenticated;
grant select (fulfillment_ready) on table public.products to anon, authenticated;
