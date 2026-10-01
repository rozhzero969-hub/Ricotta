-- Purchase receipts prepared by the office PC. The phone enters the receipt; the PC worker fills the
-- workplace "New purchase receipt" form in its own tab and stops. It never presses
-- "Receive & send to finance": a person checks the form and accepts it on the PC itself.
--   waiting -> preparing -> prepared (form filled, waiting for a person at the PC) -> closed
--   (the PC tab was submitted or left) | failed (the worker stopped; nothing was saved by it) | cancelled
create table public.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  client_key uuid not null unique,
  supplier_id text,
  supplier_name text not null check (length(supplier_name) between 1 and 160),
  invoice text not null check (length(invoice) between 1 and 60),
  currency text not null check (currency in ('IQD','USD')),
  rate numeric(14,4) check (rate is null or rate > 0),
  delivery numeric(16,2) check (delivery is null or delivery >= 0),
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 40),
  status text not null default 'waiting' check (status in ('waiting','preparing','prepared','closed','failed','cancelled')),
  message text check (message is null or length(message) <= 1000),
  shot text check (shot is null or length(shot) <= 700000),
  created_by text not null check (created_by in ('rozha','yunis')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  prepared_at timestamptz,
  finished_at timestamptz,
  check (currency = 'IQD' or rate is not null)
);
create index stock_receipts_status on public.stock_receipts(status, created_at);
create index stock_receipts_recent on public.stock_receipts(created_at desc);
alter table public.stock_receipts enable row level security;
