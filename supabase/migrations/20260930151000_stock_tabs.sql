-- Each person's tab bar may include the Transfer and Stock screens. The `api`
-- function only knows the older screens, so their choice is kept here and applied
-- by the app after it loads. Additive; nothing else changes.
create table public.stock_tabs (
  account text primary key references public.app_accounts(id) on delete cascade,
  tabs jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.stock_tabs enable row level security;
revoke all on public.stock_tabs from anon, authenticated;
grant all on public.stock_tabs to service_role;
