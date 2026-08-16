-- Supplier identities and verified alternatives are private fulfillment data.
alter table public.products
  add column if not exists supplier_id text,
  add column if not exists alternative_suppliers jsonb not null default '[]'::jsonb;

alter table public.products
  drop constraint if exists products_alternative_suppliers_array_check;
alter table public.products
  add constraint products_alternative_suppliers_array_check
  check (jsonb_typeof(alternative_suppliers) = 'array');

alter table public.orders
  add column if not exists import_compliance_plan jsonb,
  add column if not exists estimated_import_tax numeric(12,2) not null default 0;

alter table public.orders
  drop constraint if exists orders_estimated_import_tax_nonnegative;
alter table public.orders
  add constraint orders_estimated_import_tax_nonnegative
  check (estimated_import_tax >= 0);

create index if not exists products_supplier_id_idx on public.products(supplier_id);

-- These fields are only read by server-side service_role calls.
revoke select (supplier_id, alternative_suppliers) on public.products from anon, authenticated;

comment on column public.products.supplier_id is
  'Stable identity of the actual seller/store, not the marketplace name.';
comment on column public.products.alternative_suppliers is
  'Server-only verified mappings for the same product/variant at genuinely different suppliers.';
comment on column public.orders.import_compliance_plan is
  'Immutable checkout snapshot: real supplier groups, substitutions and tax estimate.';

