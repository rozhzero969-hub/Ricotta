-- Minimal stand-ins for a disposable regression database. Never run on production.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create table public.app_units(id text primary key,en text not null);
create table public.app_items(id text primary key,name text not null,unit_id text references public.app_units(id) on delete set null);
create table public.app_accounts(id text primary key);
create table public.app_suppliers(id text primary key,name text not null);
create table public.app_orders(id text primary key,status text not null,created_at timestamptz not null default now(),sent_at timestamptz,created_by text,sent_by text);
create table public.app_order_lines(id bigint generated always as identity primary key,order_id text not null references public.app_orders(id) on delete cascade,
  supplier_id text references public.app_suppliers(id) on delete set null,supplier_name text,item_id text,item_name text not null,unit_id text,qty numeric not null check(qty>0),
  unique(order_id,supplier_id,item_id));
create table public.app_item_pars(item_id text primary key references public.app_items(id) on delete cascade,par_qty numeric not null check(par_qty>0),
  est_qty numeric not null default 0 check(est_qty>=0),est_updated_at timestamptz not null default now(),last_decay_date date);
create table public.app_assistant_usage(id bigint generated always as identity primary key,device_id text,account text,model text,
  input_tokens integer not null default 0,output_tokens integer not null default 0,created_at timestamptz not null default now());
create table public.app_login_attempts(id bigint generated always as identity primary key,fingerprint_hash text not null,attempted_at timestamptz not null default now(),succeeded boolean not null default false);
