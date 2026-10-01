-- The worker reports its health every ~30 seconds, so the app can show more than on/off:
-- whether it really moves stock (live) or only checks, and whether the workplace page is ready.
alter table public.stock_worker_control
  add column worker_live boolean,
  add column worker_page_ready boolean,
  add column worker_note text check (worker_note is null or length(worker_note) <= 300);
