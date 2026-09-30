-- One row that lets the phone start the PC worker: the app records a start request, and a tiny
-- launcher on the office PC (worker/launcher.mjs) sees it and runs start-worker.cmd.
create table if not exists public.stock_worker_control (
  id int primary key default 1 check (id = 1),
  worker_seen_at timestamptz,
  launcher_seen_at timestamptz,
  start_requested_at timestamptz,
  start_requested_by text,
  start_handled_at timestamptz
);
alter table public.stock_worker_control enable row level security;
insert into public.stock_worker_control(id) values (1) on conflict do nothing;
