-- Admin, Stock names: the spelling suggestions Rico's AI made for Ricotta Restaurant's stock item names,
-- kept so the page opens at once. One row only. results is a list of {name, fixed, why}; names_hash says
-- which list of names it was made from. Only the API (service role) reads or writes it.
create table if not exists public.app_stock_names (
  id boolean primary key default true check (id),
  names_hash text not null default '',
  results jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array' and octet_length(results::text) <= 400000),
  provider text check (provider is null or provider in ('anthropic', 'gemini', 'groq')),
  checked_at timestamptz
);
alter table public.app_stock_names enable row level security;
revoke all on public.app_stock_names from public, anon, authenticated;
grant all on public.app_stock_names to service_role;
