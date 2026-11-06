-- When Rico pressed Save (a receipt) or Move it (a transfer) in Ricotta Restaurant. He records it just
-- before pressing, so even if he stops right after, the app knows it may already have happened there,
-- and a Retry, a Copy or the same one again is only sent after the person has checked.
alter table public.app_rr_receipts add column if not exists pressed_at timestamptz;
alter table public.app_rr_transfers add column if not exists pressed_at timestamptz;
