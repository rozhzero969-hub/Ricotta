-- 2026-11-16: "Check all last prices". Until the server reads Ricotta Restaurant itself (Cloud Rico,
-- which needs Rozh's PIN), Rico on the Mac reads its invoices: this month's every 15 minutes, last month's
-- once a day, and both straight away when someone presses the button in Recipes. The invoices are kept
-- in app_rr_invoices (as Cloud Rico keeps them), so recipe costs and Rico's price lookups use the last
-- price paid. The request waits here, like Check now: one at a time.
alter table public.app_rr_helper add column if not exists prices_state text check (prices_state is null or prices_state in ('asked','running'));
alter table public.app_rr_helper add column if not exists prices_asked_at timestamptz;
alter table public.app_rr_helper add column if not exists prices_started_at timestamptz;
alter table public.app_rr_helper add column if not exists prices_done_at timestamptz;
-- {ok, error, receipts, read, auto}: how the last read went, kept small.
alter table public.app_rr_helper add column if not exists prices_result jsonb
  check (prices_result is null or (jsonb_typeof(prices_result) = 'object' and pg_column_size(prices_result) <= 4000));
