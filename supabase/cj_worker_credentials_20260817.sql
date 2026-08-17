create table if not exists public.cj_worker_credentials (
  id text primary key default 'primary',
  worker_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.cj_worker_credentials enable row level security;
revoke all on table public.cj_worker_credentials from anon, authenticated;

insert into public.cj_worker_credentials(id, worker_token)
values ('primary', encode(gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;
