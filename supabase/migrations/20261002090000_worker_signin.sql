-- Workplace sign-in by the office PC: a person can ask the PC to check that the workplace site is signed in,
-- and the PC reports each check or automatic sign-in with a screenshot. The PIN itself is only on the PC.
alter table public.stock_worker_control
  add column if not exists signin_requested_at timestamptz,
  add column if not exists signin_requested_by text,
  add column if not exists signin_checked_at timestamptz,
  add column if not exists signin_ok boolean,
  add column if not exists signin_auto boolean,
  add column if not exists signin_message text check (signin_message is null or length(signin_message) <= 400),
  add column if not exists signin_shot text check (signin_shot is null or length(signin_shot) <= 800000);
