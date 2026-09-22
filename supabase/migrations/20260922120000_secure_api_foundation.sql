-- Ricotta Orders secure API foundation.
-- The browser never receives access to these tables; only Edge Functions use
-- the service-role key.  Legacy public data remains temporarily for a
-- backwards-compatible client cutover and is not modified by this migration.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create extension if not exists pgcrypto with schema extensions;

create table if not exists app_private.roles (
  role text primary key check (role in ('admin', 'staff')),
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists app_private.sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  role text not null references app_private.roles(role),
  device_id text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists sessions_active_token_idx
  on app_private.sessions(token_hash, expires_at) where revoked_at is null;

create table if not exists app_private.login_attempts (
  id bigint generated always as identity primary key,
  fingerprint_hash text not null,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null default false
);
create index if not exists login_attempts_fingerprint_time_idx
  on app_private.login_attempts(fingerprint_hash, attempted_at desc);

create table if not exists app_private.suppliers (
  id text primary key,
  name text not null check (char_length(name) between 1 and 160),
  phone text,
  reminder jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_private.units (
  id text primary key,
  en text not null check (char_length(en) between 1 and 80),
  ku text
);

create table if not exists app_private.items (
  id text primary key,
  name text not null check (char_length(name) between 1 and 160),
  unit_id text references app_private.units(id) on delete set null,
  supplier_id text references app_private.suppliers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists items_supplier_idx on app_private.items(supplier_id);

create table if not exists app_private.orders (
  id text primary key,
  status text not null check (status in ('draft', 'sent', 'deleted')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  created_by_role text check (created_by_role in ('admin','staff')),
  sent_by_role text check (sent_by_role in ('admin','staff'))
);

create table if not exists app_private.order_lines (
  id bigint generated always as identity primary key,
  order_id text not null references app_private.orders(id) on delete cascade,
  supplier_id text references app_private.suppliers(id) on delete set null,
  item_id text,
  item_name text not null,
  unit_id text,
  qty numeric not null check (qty > 0),
  unique(order_id, supplier_id, item_id)
);
create index if not exists order_lines_order_idx on app_private.order_lines(order_id);

create table if not exists app_private.devices (
  id text primary key,
  nickname text,
  role text check (role in ('admin','staff')),
  logged_in boolean not null default false,
  last_login timestamptz,
  last_seen timestamptz,
  command jsonb,
  handled_command text,
  updated_at timestamptz not null default now()
);

create table if not exists app_private.audit_events (
  id text primary key,
  occurred_at timestamptz not null default now(),
  actor_role text check (actor_role in ('admin','staff')),
  device_id text,
  action text not null,
  entity_type text,
  entity_name text,
  payload jsonb not null default '{}'::jsonb
);
create index if not exists audit_events_time_idx on app_private.audit_events(occurred_at desc);

create table if not exists app_private.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  device_id text,
  lang text not null default 'en' check (lang in ('en','ku')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_private.reminder_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  remind_time time not null default time '09:00',
  last_sent_date date
);

-- These RPCs are callable only by the service role used inside the single
-- Edge API. They are never available to a browser role.
create or replace function public.app_internal_verify_pin(p_pin text)
returns text
language plpgsql
security definer
set search_path = app_private, extensions, pg_temp
as $$
declare matched_role text;
begin
  if p_pin !~ '^[0-9]{4,6}$' then return null; end if;
  select role into matched_role from app_private.roles
    where extensions.crypt(p_pin, pin_hash) = pin_hash
    order by case role when 'admin' then 0 else 1 end
    limit 1;
  return matched_role;
end;
$$;
create or replace function public.app_internal_set_pins(p_admin_pin text, p_staff_pin text)
returns void
language plpgsql
security definer
set search_path = app_private, extensions, pg_temp
as $$
begin
  if p_admin_pin !~ '^[0-9]{6}$' or p_staff_pin !~ '^[0-9]{4}$' or p_admin_pin like p_staff_pin || '%' then
    raise exception 'invalid PIN format';
  end if;
  update app_private.roles set pin_hash = extensions.crypt(case role when 'admin' then p_admin_pin else p_staff_pin end, extensions.gen_salt('bf', 12)), updated_at=now();
  update app_private.sessions set revoked_at=now() where revoked_at is null;
end;
$$;

-- Import the current shared PINs as bcrypt hashes.  This runs only when no
-- modern role exists, so reapplying the migration never changes a PIN.
insert into app_private.roles(role, pin_hash)
select 'admin', extensions.crypt(value->>'adminPin', extensions.gen_salt('bf', 12))
from public.app_data where key = 'settings'
  and value ? 'adminPin'
  and not exists (select 1 from app_private.roles where role = 'admin')
on conflict do nothing;
insert into app_private.roles(role, pin_hash)
select 'staff', extensions.crypt(value->>'userPin', extensions.gen_salt('bf', 12))
from public.app_data where key = 'settings'
  and value ? 'userPin'
  and not exists (select 1 from app_private.roles where role = 'staff')
on conflict do nothing;

-- Import catalog and notification data.  Invalid or duplicate legacy rows are
-- ignored rather than blocking the security migration.
insert into app_private.units(id,en,ku)
select x->>'id', coalesce(nullif(x->>'en',''), x->>'id'), nullif(x->>'ku','')
from public.app_data d cross join lateral jsonb_array_elements(coalesce(d.value,'[]'::jsonb)) x
where d.key='units' and coalesce(x->>'id','') <> ''
on conflict (id) do nothing;
insert into app_private.suppliers(id,name,phone,reminder)
select x->>'id', x->>'name', nullif(x->>'phone',''), x->'reminder'
from public.app_data d cross join lateral jsonb_array_elements(coalesce(d.value,'[]'::jsonb)) x
where d.key='suppliers' and coalesce(x->>'id','') <> '' and coalesce(x->>'name','') <> ''
on conflict (id) do nothing;
insert into app_private.items(id,name,unit_id,supplier_id)
select x->>'id', x->>'name', nullif(x->>'unit',''), nullif(x->>'supplierId','')
from public.app_data d cross join lateral jsonb_array_elements(coalesce(d.value,'[]'::jsonb)) x
where d.key='items' and coalesce(x->>'id','') <> '' and coalesce(x->>'name','') <> ''
on conflict (id) do nothing;
insert into app_private.orders(id,status,created_at,sent_at)
select h->>'id', 'sent', coalesce(nullif(h->>'date','')::timestamptz, now()), coalesce(nullif(h->>'date','')::timestamptz, now())
from public.app_data d cross join lateral jsonb_array_elements(coalesce(d.value,'[]'::jsonb)) h
where d.key='orderHistory' and coalesce(h->>'id','') <> ''
on conflict (id) do nothing;
insert into app_private.order_lines(order_id,supplier_id,item_id,item_name,unit_id,qty)
select h->>'id', nullif(e->>'supplierId',''), nullif(i->>'itemId',''),
       coalesce(nullif(i->>'name',''), i->>'itemId', 'Item'), nullif(i->>'unit',''),
       greatest(coalesce(nullif(i->>'qty','')::numeric, 1), 0.0001)
from public.app_data d
cross join lateral jsonb_array_elements(coalesce(d.value,'[]'::jsonb)) h
cross join lateral jsonb_array_elements(coalesce(h->'entries','[]'::jsonb)) e
cross join lateral jsonb_array_elements(coalesce(e->'items','[]'::jsonb)) i
where d.key='orderHistory' and coalesce(h->>'id','') <> ''
on conflict (order_id,supplier_id,item_id) do nothing;
insert into app_private.devices(id,nickname,role,logged_in,last_login,last_seen,command,handled_command)
select x->>'id', nullif(x->>'nickname',''), nullif(x->>'role',''), coalesce((x->>'loggedIn')::boolean,false),
       nullif(x->>'lastLogin','')::timestamptz, nullif(x->>'lastSeen','')::timestamptz,
       x->'command', nullif(x->>'handledCommand','')
from public.app_data d cross join lateral jsonb_array_elements(coalesce(d.value,'[]'::jsonb)) x
where d.key='devices' and coalesce(x->>'id','') <> ''
on conflict (id) do nothing;
insert into app_private.audit_events(id,occurred_at,actor_role,device_id,action,entity_type,entity_name,payload)
select x->>'id', coalesce(nullif(x->>'ts','')::timestamptz, now()), nullif(x->>'role',''),
       nullif(x->>'deviceId',''), coalesce(nullif(x->>'action',''),'legacy'), nullif(x->>'type',''),
       nullif(x->>'name',''), x
from public.app_data d cross join lateral jsonb_array_elements(coalesce(d.value,'[]'::jsonb)) x
where d.key='activityLog' and coalesce(x->>'id','') <> ''
on conflict (id) do nothing;
insert into app_private.push_subscriptions(endpoint,p256dh,auth,device_id,lang,created_at,updated_at)
select endpoint,p256dh,auth,device_id,lang,created_at,updated_at from public.push_subscriptions
on conflict (endpoint) do nothing;
insert into app_private.reminder_settings(id,enabled,remind_time,last_sent_date)
select true, enabled, remind_time::time, last_sent_date from public.push_reminder where id=1
on conflict (id) do nothing;

-- Lock down every legacy public table and existing public RPC.  The legacy
-- objects are intentionally retained until the new browser client is live.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.app_internal_verify_pin(text) to service_role;
grant execute on function public.app_internal_set_pins(text,text) to service_role;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

-- New internal tables are not a Data API surface.
alter table app_private.roles enable row level security;
alter table app_private.sessions enable row level security;
alter table app_private.login_attempts enable row level security;
alter table app_private.suppliers enable row level security;
alter table app_private.units enable row level security;
alter table app_private.items enable row level security;
alter table app_private.orders enable row level security;
alter table app_private.order_lines enable row level security;
alter table app_private.devices enable row level security;
alter table app_private.audit_events enable row level security;
alter table app_private.push_subscriptions enable row level security;
alter table app_private.reminder_settings enable row level security;
