-- Applied to production on 2026-08-16 after the safe public catalog deployment.
-- Supplier shipping cost/timestamps are internal fulfillment data and must not be browser-readable.
revoke select (supplier_shipping, shipping_currency, shipping_last_checked_at)
on table public.products
from anon, authenticated;
