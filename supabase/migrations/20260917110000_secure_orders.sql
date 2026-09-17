-- Secure Ricotta data model. Legacy app_data is retained only as a migration source.
create extension if not exists pgcrypto;

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  role text not null unique check (role in ('admin','staff')),
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.suppliers (
  id text primary key, name text not null, phone text, created_at timestamptz not null default now()
);
create table public.units (
  id text primary key, en text not null, ku text
);
create table public.items (
  id text primary key, name text not null, unit_id text references public.units(id), supplier_id text references public.suppliers(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id text references public.suppliers(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','sent')),
  created_by uuid references public.app_users(id),
  sent_by uuid references public.app_users(id),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id text references public.items(id) on delete set null,
  item_name text not null, unit_id text, quantity integer not null check (quantity > 0)
);

-- Preserve catalog data.
insert into public.suppliers (id,name,phone)
select x->>'id', x->>'name', x->>'phone'
from public.app_data, jsonb_array_elements(value) x where key='suppliers'
on conflict (id) do nothing;
insert into public.units (id,en,ku)
select x->>'id', x->>'en', x->>'ku'
from public.app_data, jsonb_array_elements(value) x where key='units'
on conflict (id) do nothing;
insert into public.items (id,name,unit_id,supplier_id)
select x->>'id', x->>'name', x->>'unit', nullif(x->>'supplierId','')
from public.app_data, jsonb_array_elements(value) x where key='items'
on conflict (id) do nothing;
insert into public.app_users(role,pin_hash)
select 'admin', crypt(value->>'adminPin', gen_salt('bf')) from public.app_data where key='settings'
union all
select 'staff', crypt(value->>'userPin', gen_salt('bf')) from public.app_data where key='settings';

create or replace function public.ricotta_verify_pin(p_pin text)
returns table(id uuid, role text)
language sql security definer set search_path = public, pg_temp
as $$
  select id, role from public.app_users
  where active and pin_hash = crypt(p_pin, pin_hash)
  limit 1;
$$;

-- Legacy history becomes immutable sent supplier orders.
with history as (
  select (r->>'date')::timestamptz as ordered_at, e
  from public.app_data, jsonb_array_elements(value) r, jsonb_array_elements(r->'entries') e
  where key='orderHistory'
), inserted as (
  insert into public.orders(supplier_id,status,sent_at,created_at,updated_at)
  select nullif(e->>'supplierId','__none'),'sent',ordered_at,ordered_at,ordered_at from history
  returning id, supplier_id, sent_at
)
insert into public.order_lines(order_id,item_id,item_name,unit_id,quantity)
select o.id, i->>'itemId', i->>'name', i->>'unit', (i->>'qty')::integer
from inserted o
join history h on h.ordered_at=o.sent_at and nullif(h.e->>'supplierId','__none') is not distinct from o.supplier_id
cross join lateral jsonb_array_elements(h.e->'items') i;

-- Browser access is blocked. Only the Edge Function uses the server secret.
alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.suppliers enable row level security;
alter table public.units enable row level security;
alter table public.items enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
drop policy if exists "anon can insert non-secret app_data" on public.app_data;
drop policy if exists "anon can read non-secret app_data" on public.app_data;
drop policy if exists "anon can update non-secret app_data" on public.app_data;
revoke all on public.app_data from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated;
drop function if exists public.app_get_cloud_config(text);
drop function if exists public.app_get_pins(text);
drop function if exists public.app_set_cloud_config(text,text,text,text);
drop function if exists public.app_set_pins(text,text,text);
drop function if exists public.app_verify_pin(text);
