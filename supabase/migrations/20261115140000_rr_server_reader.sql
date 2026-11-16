-- 2026-11-15: the server reads Ricotta Restaurant itself (api rr-reader.ts, called every minute by
-- send-push's tick), so the stock, items, units and names stay current even with Rozh's Mac off, and
-- Rico can answer from every invoice there.

-- Cloud Rico's state for Admin: when it last ran and last read each list, the problem now (kind, plain
-- cause, since when), whether Rozh was alerted about it, and the last 50 runs. The sign-in token is kept
-- here so it is not signed in again every minute; only the service role can read this table.
create table if not exists public.app_rr_reader (
  id boolean primary key default true check (id),
  token text check (token is null or length(token) <= 4000),
  last_run_at timestamptz,
  catalog_ok_at timestamptz,
  invoices_ok_at timestamptz,
  prev_month_day text check (prev_month_day is null or prev_month_day ~ '^\d{4}-\d{2}-\d{2}$'),
  history_at timestamptz,
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  problem jsonb check (problem is null or jsonb_typeof(problem) = 'object'),
  alerted text check (alerted is null or length(alerted) <= 20),
  log jsonb not null default '[]'::jsonb check (jsonb_typeof(log) = 'array' and jsonb_array_length(log) <= 60),
  updated_at timestamptz not null default now()
);

-- Every invoice in Ricotta Restaurant (all suppliers, not only the ones Rico entered), with its lines:
-- item, the unit it was bought in, amount, price per unit and total. Kept 60 days, like the rest.
create table if not exists public.app_rr_invoices (
  id text primary key check (length(id) between 1 and 80),
  entry_date date not null,
  invoice_number text not null default '' check (length(invoice_number) <= 80),
  supplier_id text check (supplier_id is null or length(supplier_id) <= 80),
  supplier_name text not null default '' check (length(supplier_name) <= 200),
  status text not null default '' check (length(status) <= 30),
  currency text not null default 'IQD' check (currency in ('IQD', 'USD')),
  total numeric not null default 0,
  delivery_fee numeric not null default 0,
  paid boolean not null default false,
  line_count integer not null default 0 check (line_count >= 0),
  returned_value numeric not null default 0,
  wasted_value numeric not null default 0,
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  read_at timestamptz not null default now()
);
create index if not exists app_rr_invoices_entry_date on public.app_rr_invoices (entry_date desc);

alter table public.app_rr_reader enable row level security;
alter table public.app_rr_invoices enable row level security;
revoke all on public.app_rr_reader, public.app_rr_invoices from public, anon, authenticated;
grant all on public.app_rr_reader, public.app_rr_invoices to service_role;

-- Invoices older than 60 days go, every night.
create or replace function public.app_internal_rr_invoices_cleanup(p_now timestamptz default now())
returns void language sql security definer set search_path = '' as $$
  delete from public.app_rr_invoices where entry_date < ((p_now at time zone 'Asia/Baghdad')::date - 60);
$$;
revoke all on function public.app_internal_rr_invoices_cleanup(timestamptz) from public, anon, authenticated;
grant execute on function public.app_internal_rr_invoices_cleanup(timestamptz) to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ricotta-rr-invoices-cleanup', '47 0 * * *', $sql$select public.app_internal_rr_invoices_cleanup()$sql$);
  end if;
end $$;
