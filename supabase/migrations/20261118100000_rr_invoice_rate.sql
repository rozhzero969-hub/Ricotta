-- 2026-11-18: the exchange rate of Ricotta Restaurant's USD receipts (its exchange_rate: IQD for 1 USD),
-- kept with each invoice so a price paid in USD shows in IQD in Recipes and Items. Null for IQD receipts
-- and for USD receipts read before this (they are read again when they change, or use the newest rate).
alter table public.app_rr_invoices add column if not exists rate numeric
  check (rate is null or (rate > 0 and rate < 100000));
