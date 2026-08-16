create table if not exists public.products (
  id text primary key,
  name text not null,
  selling_price numeric(12,2) not null check (selling_price >= 0),
  currency text not null default 'ILS',
  active boolean not null default true,
  image_url text,
  supplier text not null default 'aliexpress',
  supplier_url text,
  supplier_product_id text,
  supplier_sku_id text,
  variant_label text,
  fulfillment_ready boolean not null default false,
  supplier_price numeric(12,2),
  supplier_shipping numeric(12,2),
  supplier_in_stock boolean,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;

drop policy if exists public_can_read_active_products on public.products;
create policy public_can_read_active_products
on public.products
for select
to anon, authenticated
using (active = true);

alter table public.orders
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payment_provider text,
  add column if not exists payment_reference text,
  add column if not exists fulfillment_status text not null default 'not_started',
  add column if not exists supplier_order_id text,
  add column if not exists tracking_number text,
  add column if not exists shipping_cost numeric(12,2) not null default 0,
  add column if not exists supplier_cost numeric(12,2),
  add column if not exists idempotency_key text,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists orders_idempotency_key_unique
  on public.orders(idempotency_key)
  where idempotency_key is not null;

create index if not exists orders_payment_status_idx on public.orders(payment_status);
create index if not exists orders_fulfillment_status_idx on public.orders(fulfillment_status);
create index if not exists products_active_idx on public.products(active);
create index if not exists products_supplier_product_id_idx on public.products(supplier_product_id);

drop policy if exists public_can_insert_orders on public.orders;

insert into public.products (
  id, name, selling_price, currency, active, image_url,
  supplier, supplier_url, supplier_product_id, supplier_sku_id,
  variant_label, fulfillment_ready
) values
  ('socket', 'סט בוקסות וראצ׳ט 46 חלקים', 69.90, 'ILS', true, 'https://mccrossllc.com/cdn/shop/collections/Hd057284a50f044f488d86e11ab470579h.jpg?v=1670719362', 'aliexpress', 'https://www.aliexpress.com/item/1005012906553288.html', '1005012906553288', null, null, false),
  ('ratchet', 'ראצ׳ט חשמלי זוויתי 120W', 139.90, 'ILS', true, 'https://i5.walmartimages.com/seo/18V-Electric-Ratchet-Wrench-1-2-Right-Angle-Ratchet-for-Makita-18V-Battery-Hand-Impact-Driver-Tools-Wrench-Blue-130nm_1bf0f543-88ef-4f78-8cb7-04f91a3194f8.724ab8f3f2c10f5cb5f41b4a8e82f73d.jpeg', 'aliexpress', 'https://www.aliexpress.com/item/1005012879937902.html', '1005012879937902', null, 'Body only / no battery', false),
  ('impact', 'מפתח אימפקט אלחוטי 18V – 520Nm', 79.90, 'ILS', true, 'https://img.joomcdn.net/181eebb2cb57412f67c7470f00fda90d41bc9c43_1024_1024.jpeg', 'aliexpress', 'https://a.aliexpress.com/_c4qlMwlt', '1005010616492119', null, 'Body only / no battery', false),
  ('battery588', 'סוללת 588VF + מטען תואם Makita', 110.00, 'ILS', true, 'https://img.joomcdn.net/239ccb6ea20a6834688ad30623c038a2d1bbfa26_original.jpeg', 'aliexpress', 'https://a.aliexpress.com/_c3mUoejd', '1005008055230578', null, 'Battery 1 Charger 1', false),
  ('washer', 'מכונת שטיפה אלחוטית תואמת Makita 18V', 160.00, 'ILS', true, '/washer-set1.jpg.PNG', 'aliexpress', 'https://a.aliexpress.com/_c39RYxFp', '1005006994420769', null, 'Set 1', false)
on conflict (id) do update set
  name = excluded.name,
  selling_price = excluded.selling_price,
  currency = excluded.currency,
  active = excluded.active,
  image_url = excluded.image_url,
  supplier = excluded.supplier,
  supplier_url = excluded.supplier_url,
  supplier_product_id = excluded.supplier_product_id,
  variant_label = excluded.variant_label,
  fulfillment_ready = excluded.fulfillment_ready,
  updated_at = now();
