-- Audit repairs (F14, F15, F27), 2026-10-28.
-- F14: time in the app is never credited for more than the time that really passed since that phone last
--      reported: the 15 seconds of slack were granted again on every report (20 reports at once = 315 s).
-- F15: each upload carries a batch id; the same batch sent again (its answer was lost) is counted once.
-- F27: Rico's test orders and saved Rico chats are kept 90 days, removed by the nightly clean-up.

create table if not exists public.app_usage_batches (
  id text primary key check (length(id) = 36),
  account text not null check (account in ('rozha','yunis')),
  created_at timestamptz not null default now()
);
create index if not exists app_usage_batches_created_idx on public.app_usage_batches (created_at);
alter table public.app_usage_batches enable row level security;
revoke all on public.app_usage_batches from public, anon, authenticated;
grant all on public.app_usage_batches to service_role;

drop function if exists public.app_internal_add_usage(text,text,text,integer);
create function public.app_internal_add_usage(p_account text, p_device text, p_label text, p_seconds integer, p_batch text default null)
returns integer language plpgsql set search_path = '' as $$
declare credited integer := least(greatest(coalesce(p_seconds, 0), 0), 1800); last timestamptz; today date := (now() at time zone 'Asia/Baghdad')::date;
begin
  if p_account not in ('rozha','yunis') or p_device is null or length(p_device) not between 1 and 200 then raise exception 'Invalid usage'; end if;
  perform pg_advisory_xact_lock(hashtextextended('usage:' || p_account || ':' || p_device, 0));
  if p_batch is not null then
    insert into public.app_usage_batches(id, account) values (p_batch, p_account) on conflict (id) do nothing;
    if not found then return 0; end if;   -- this batch was already counted
  end if;
  select max(updated_at) into last from public.app_usage_time where account = p_account and device_id = p_device;
  if last is not null then credited := least(credited, greatest(0, floor(extract(epoch from now() - last))::integer)); end if;
  if credited <= 0 then return 0; end if;
  insert into public.app_usage_time as u(account, device_id, day, seconds, device_label, updated_at)
    values (p_account, p_device, today, least(86400, credited), left(p_label, 80), now())
    on conflict (account, device_id, day) do update set seconds = least(86400, u.seconds + excluded.seconds),
      device_label = coalesce(excluded.device_label, u.device_label), updated_at = now();
  return credited;
end $$;
revoke all on function public.app_internal_add_usage(text,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.app_internal_add_usage(text,text,text,integer,text) to service_role;

create or replace function public.app_internal_cleanup()
returns void language plpgsql set search_path = '' as $$
begin
 perform public.app_internal_monthly_cleanup();
 delete from public.app_item_undo where expires_at<=now();
 delete from public.app_login_attempts where attempted_at<now()-interval '2 days';
 delete from public.app_sessions where coalesce(revoked_at,expires_at)<now()-interval '2 days';
 delete from public.app_devices where not logged_in and coalesce(last_seen,updated_at)<now()-interval '30 days';
 delete from public.app_assistant_alerts where sent_at<now()-interval '30 days';
 delete from public.app_assistant_usage where created_at<now()-interval '90 days';
 delete from public.app_rico_inbox where created_at<now()-interval '30 days';
 delete from public.app_security_events where occurred_at<now()-interval '90 days';
 delete from public.app_problem_reports where (resolved_at is not null and resolved_at<now()-interval '30 days') or last_at<now()-interval '120 days';
 -- Kept 90 days (the privacy page says so): Rico's test orders, and saved Rico chats not touched since.
 delete from public.app_rico_orders where created_at<now()-interval '90 days';
 delete from public.app_rico_chats where updated_at<now()-interval '90 days';
 delete from public.app_usage_batches where created_at<now()-interval '7 days';
end $$;
revoke all on function public.app_internal_cleanup() from public,anon,authenticated;
grant execute on function public.app_internal_cleanup() to service_role;
