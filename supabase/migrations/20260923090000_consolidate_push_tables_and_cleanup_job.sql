-- Bring the canonical app_* push tables up to date from the legacy push_* ones,
-- move the supplier-reminder claim onto app_push_supplier_sent, and add a
-- daily housekeeping job so server-only tables never grow forever.
insert into public.app_push_subscriptions (endpoint, p256dh, auth, device_id, lang, created_at, updated_at)
select endpoint, p256dh, auth, device_id, coalesce(lang,'en'), created_at, updated_at from public.push_subscriptions
on conflict (endpoint) do update set p256dh=excluded.p256dh, auth=excluded.auth,
  device_id=coalesce(excluded.device_id, public.app_push_subscriptions.device_id), lang=excluded.lang, updated_at=excluded.updated_at
where excluded.updated_at > public.app_push_subscriptions.updated_at;

insert into public.app_reminder_settings (id, enabled, remind_time, last_sent_date)
select true, enabled, remind_time::time, last_sent_date from public.push_reminder where id = 1
on conflict (id) do update set enabled=excluded.enabled, remind_time=excluded.remind_time, last_sent_date=excluded.last_sent_date;

create table if not exists public.app_push_supplier_sent (
  supplier_id text primary key,
  sent_key text not null,
  sent_at timestamptz not null default now()
);
alter table public.app_push_supplier_sent enable row level security;
revoke all on public.app_push_supplier_sent from anon, authenticated;
grant all on public.app_push_supplier_sent to service_role;
insert into public.app_push_supplier_sent (supplier_id, sent_key, sent_at)
select supplier_id, sent_key, sent_at from public.push_supplier_sent on conflict do nothing;

create or replace function public.app_internal_claim_supplier(p_supplier_id text, p_key text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  insert into public.app_push_supplier_sent (supplier_id, sent_key) values (p_supplier_id, p_key)
  on conflict (supplier_id) do update set sent_key = excluded.sent_key, sent_at = now()
    where public.app_push_supplier_sent.sent_key is distinct from excluded.sent_key;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.app_internal_claim_supplier(text,text) from public, anon, authenticated;
grant execute on function public.app_internal_claim_supplier(text,text) to service_role;

create or replace function public.app_internal_cleanup()
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.app_login_attempts where attempted_at < now() - interval '2 days';
  delete from public.app_sessions where coalesce(revoked_at, expires_at) < now() - interval '2 days';
  delete from public.app_devices where logged_in = false and coalesce(last_seen, updated_at) < now() - interval '30 days';
  delete from public.app_audit_events where occurred_at < now() - interval '400 days';
$$;
revoke execute on function public.app_internal_cleanup() from public, anon, authenticated;
select cron.schedule('ricotta-daily-cleanup', '17 0 * * *', 'select public.app_internal_cleanup()');

-- Heartbeat noise written by the old api into the Record table.
delete from public.app_audit_events where action = 'replace_state';

-- Redundant indexes (token_hash already has a unique index; role has 2 values).
drop index if exists public.sessions_active_token_idx;
drop index if exists public.app_sessions_role_idx;
