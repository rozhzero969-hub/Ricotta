-- 2026-11-02 big update, part 1: one wipe day every 60 days for everything that is history.
-- On the wipe day, orders, the Record of changes, Rico's test orders and saved Rico chats older than 60 days
-- are deleted, so 60 to 120 days are kept. The app warns 2 days before. A finished month still gets its summary.

create table if not exists public.app_wipe (
  id boolean primary key default true check (id),
  next_wipe date not null,
  last_wipe date
);
alter table public.app_wipe enable row level security;
revoke all on public.app_wipe from public, anon, authenticated;
grant all on public.app_wipe to service_role;
insert into public.app_wipe(id, next_wipe)
  values (true, (now() at time zone 'Asia/Baghdad')::date + 60)
  on conflict (id) do nothing;

create or replace function public.app_internal_monthly_cleanup(p_now timestamptz default now())
returns void language plpgsql set search_path = '' as $$
declare
  cutoff timestamptz := date_trunc('month', p_now at time zone 'Asia/Baghdad') at time zone 'Asia/Baghdad';
  today date := (p_now at time zone 'Asia/Baghdad')::date;
  older timestamptz := p_now - interval '60 days';
  due date; m record;
begin
 for m in select date_trunc('month', coalesce(sent_at, created_at) at time zone 'Asia/Baghdad') as ms
   from public.app_orders where status = 'sent' and coalesce(sent_at, created_at) < cutoff group by 1
 loop
  if not exists (select 1 from public.app_month_summaries where month = to_char(m.ms, 'YYYY-MM')) then
   insert into public.app_month_summaries(month, data)
   values (to_char(m.ms, 'YYYY-MM'), public.app_internal_month_summary(m.ms at time zone 'Asia/Baghdad', (m.ms + interval '1 month') at time zone 'Asia/Baghdad'))
   on conflict (month) do nothing;
  end if;
 end loop;
 select next_wipe into due from public.app_wipe where id;
 if due is null or today < due then return; end if;
 delete from public.app_orders where coalesce(sent_at, created_at) < older;
 delete from public.app_audit_events where occurred_at < older;
 delete from public.app_rico_orders where created_at < older;
 delete from public.app_rico_chats where updated_at < older;
 -- The next wipe is 60 days after the one that was due; a long outage still lands in the future.
 while due <= today loop due := due + 60; end loop;
 update public.app_wipe set next_wipe = due, last_wipe = today where id;
end $$;
revoke all on function public.app_internal_monthly_cleanup(timestamptz) from public, anon, authenticated;
grant execute on function public.app_internal_monthly_cleanup(timestamptz) to service_role;

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
 delete from public.app_usage_batches where created_at<now()-interval '7 days';
end $$;
revoke all on function public.app_internal_cleanup() from public,anon,authenticated;
grant execute on function public.app_internal_cleanup() to service_role;
