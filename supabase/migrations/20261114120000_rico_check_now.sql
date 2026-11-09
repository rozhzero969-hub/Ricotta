-- 2026-11-14: "Check now". Rico on Rozha's Mac reads Ricotta Restaurant's suppliers, zones, items and
-- units every 10 minutes. A button in the app now asks him to do it straight away: the request waits
-- here, Rico takes it between jobs (within a second or two when he is free), reads everything, and
-- says how it went and what changed. One check at a time: while one is asked or running, the button
-- can't ask for another.
alter table public.app_rr_helper add column if not exists sync_state text check (sync_state is null or sync_state in ('asked','running'));
alter table public.app_rr_helper add column if not exists sync_by text check (sync_by is null or sync_by in ('rozha','yunis'));
alter table public.app_rr_helper add column if not exists sync_asked_at timestamptz;
alter table public.app_rr_helper add column if not exists sync_started_at timestamptz;
alter table public.app_rr_helper add column if not exists sync_done_at timestamptz;
-- {ok, error, changes}: what the last check found (new, removed and changed names), kept small.
alter table public.app_rr_helper add column if not exists sync_result jsonb
  check (sync_result is null or (jsonb_typeof(sync_result) = 'object' and pg_column_size(sync_result) <= 20000));

-- The app hears at once when a check is asked, starts and ends (and then reads the new lists).
drop trigger if exists app_signal_receipts_helper on public.app_rr_helper;
create trigger app_signal_receipts_helper after update on public.app_rr_helper for each row
  when (old.signed_in is distinct from new.signed_in or old.stopped is distinct from new.stopped or old.auto_approve is distinct from new.auto_approve
    or old.mode is distinct from new.mode or old.command is distinct from new.command or old.launch_result is distinct from new.launch_result
    or old.launch_at is distinct from new.launch_at
    or old.sync_state is distinct from new.sync_state or old.sync_done_at is distinct from new.sync_done_at
    or (old.last_seen is null) <> (new.last_seen is null) or old.last_seen < now() - interval '2 minutes'
    or (old.launcher_seen is null) <> (new.launcher_seen is null) or old.launcher_seen < now() - interval '2 minutes')
  execute function public.app_signal_bump('receipts');
