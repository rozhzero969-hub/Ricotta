-- When the office PC could not start the worker (browser, page or settings problem), it says why.
-- The app shows the message while the worker is off, so a silent failure is visible on the phone.
alter table public.stock_worker_control
  add column if not exists worker_problem text check (char_length(worker_problem) <= 400),
  add column if not exists worker_problem_at timestamptz;
