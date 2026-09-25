-- Par-level stock ESTIMATES for items the kitchen chooses to track (opt-in,
-- one row per tracked item). Ricotta has no consumption/receiving system of
-- its own, so this is deliberately an estimate, not a fact:
--   - est_qty goes UP when an order for the item is sent (api/index.ts,
--     bumpStockOnSend, called from saveOrder).
--   - est_qty goes DOWN once a day (send-push's cron tick, stockDecayTick),
--     by a rate learned from the item's own order history. last_decay_date
--     makes that a once-per-day operation no matter how often the tick runs.
--   - The person can correct it any time by telling Rico the real count
--     (assistant.ts, the set_stock_count tool) -- no separate screen needed.
-- par_qty is the normal target; busy_boost_pct raises it automatically on
-- the item's own busiest ordering weekdays (assistant.ts, stockRows).
create table if not exists public.app_item_pars (
  item_id text primary key references public.app_items(id) on delete cascade,
  par_qty numeric not null check (par_qty > 0),
  busy_boost_pct numeric not null default 50 check (busy_boost_pct >= 0),
  est_qty numeric not null default 0 check (est_qty >= 0),
  est_updated_at timestamptz not null default now(),
  last_decay_date date,
  created_at timestamptz not null default now()
);
alter table public.app_item_pars enable row level security;
revoke all on public.app_item_pars from anon, authenticated;
grant all on public.app_item_pars to service_role;
