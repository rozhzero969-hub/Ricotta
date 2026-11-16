-- 2026-11-16: Admin alerts Rozh about mistakes in Ricotta Restaurant's item names. Whenever the names
-- change there (a new item, or a name she fixed), only the new names go to Rico's AI for spelling, and
-- Rozh hears once about mistakes she hasn't heard about yet (Rico's inbox and her phones). She fixes
-- them in Ricotta Restaurant little by little; Admin, Stock names shows what is left and how many are
-- fixed.
alter table public.app_stock_names add column if not exists checked_names jsonb not null default '[]'::jsonb
  check (jsonb_typeof(checked_names) = 'array' and octet_length(checked_names::text) <= 200000);
alter table public.app_stock_names add column if not exists alerted jsonb not null default '[]'::jsonb
  check (jsonb_typeof(alerted) = 'array' and octet_length(alerted::text) <= 200000);
