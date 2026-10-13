-- Removes what earlier versions left behind and closes two loose ends.
-- Nothing the app reads or writes changes.

-- An empty schema from an earlier design.
drop schema if exists app_private;

-- An old push key pair and an old cron secret. No code reads them: the Edge Functions use their own
-- secrets and the minute tick sends its own header. Rico's provider keys and the recovery hashes stay.
delete from public.app_secrets where key in ('cron_secret', 'vapid_private', 'vapid_public');

-- Only the two accounts and sent orders exist now. The old roles (admin, staff) and order states
-- (draft, deleted) are gone from the app and from the data, so the checks no longer allow them.
alter table public.app_orders drop constraint if exists orders_status_check;
alter table public.app_orders add constraint orders_status_check check (status = 'sent');
alter table public.app_orders drop constraint if exists app_orders_created_by_check;
alter table public.app_orders add constraint app_orders_created_by_check check (created_by in ('rozha', 'yunis'));
alter table public.app_orders drop constraint if exists app_orders_sent_by_check;
alter table public.app_orders add constraint app_orders_sent_by_check check (sent_by in ('rozha', 'yunis'));
alter table public.app_audit_events drop constraint if exists app_audit_events_actor_check;
alter table public.app_audit_events add constraint app_audit_events_actor_check check (actor in ('rozha', 'yunis'));

-- Tables and functions are closed to the browser roles by default, sequences were not: every new
-- identity column (Rico's inbox and usage, kitchen notes) was usable by anon and authenticated.
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- pg_cron keeps a row for every run (1,440 a day for the minute tick) and never removes them.
-- Keep a week for troubleshooting, and clear older rows every night.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $sql$delete from cron.job_run_details where end_time < now() - interval '7 days'$sql$;
    perform cron.schedule('ricotta-cron-history', '23 0 * * *',
      $sql$delete from cron.job_run_details where end_time < now() - interval '7 days'$sql$);
  end if;
end $$;
