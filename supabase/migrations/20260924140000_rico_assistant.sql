-- Rico, the in-app AI assistant.
--
-- 1. Each device can carry the name of the person using it, so Rico knows
--    who it is talking to (PINs are shared, so identity is per device).
alter table public.app_devices add column if not exists person_name text;

-- 2. Late-order alerts Rico has already sent (one row per alert, so the
--    every-minute tick in send-push can never send the same alert twice).
create table if not exists public.app_assistant_alerts (
  id text primary key,                  -- e.g. "overdue|<supplier id>|2026-09-24"
  kind text not null,
  supplier_id text,
  sent_at timestamptz not null default now()
);
alter table public.app_assistant_alerts enable row level security;
revoke all on public.app_assistant_alerts from anon, authenticated;
grant all on public.app_assistant_alerts to service_role;

-- 3. One row per Rico reply: used for a per-device hourly limit and to see
--    how much the assistant is used.
create table if not exists public.app_assistant_usage (
  id bigint generated always as identity primary key,
  device_id text,
  role text,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists app_assistant_usage_device_time_idx on public.app_assistant_usage (device_id, created_at desc);
alter table public.app_assistant_usage enable row level security;
revoke all on public.app_assistant_usage from anon, authenticated;
grant all on public.app_assistant_usage to service_role;

-- 4. Daily housekeeping also trims the assistant tables.
create or replace function public.app_internal_cleanup()
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.app_login_attempts where attempted_at < now() - interval '2 days';
  delete from public.app_sessions where coalesce(revoked_at, expires_at) < now() - interval '2 days';
  delete from public.app_devices where logged_in = false and coalesce(last_seen, updated_at) < now() - interval '30 days';
  delete from public.app_audit_events where occurred_at < now() - interval '400 days';
  delete from public.app_assistant_alerts where sent_at < now() - interval '30 days';
  delete from public.app_assistant_usage where created_at < now() - interval '90 days';
$$;
revoke execute on function public.app_internal_cleanup() from public, anon, authenticated;
