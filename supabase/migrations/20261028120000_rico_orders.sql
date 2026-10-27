-- ROZH-25 step 2: orders Rico sent by himself over WhatsApp. Kept apart from the kitchen's own orders:
-- never in History, the monthly report or the streak. While testing, every message goes only to
-- Rozha's own WhatsApp (test = true). Server only; Rozha reads them through the api.
create table if not exists public.app_rico_orders (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  account text not null check (account in ('rozha', 'yunis')),
  supplier_id text,
  supplier_name text not null check (length(supplier_name) between 1 and 200),
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 200),
  reason text not null default '' check (length(reason) <= 500),
  status text not null check (status in ('sent', 'failed')),
  error text check (error is null or length(error) <= 100),
  message_id text check (message_id is null or length(message_id) <= 200),
  test boolean not null default true
);
create index if not exists app_rico_orders_created_idx on public.app_rico_orders (created_at desc);
alter table public.app_rico_orders enable row level security;
revoke all on public.app_rico_orders from public, anon, authenticated;
grant all on public.app_rico_orders to service_role;
