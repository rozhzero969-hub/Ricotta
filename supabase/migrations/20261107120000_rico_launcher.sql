-- 2026-11-07: start and stop Rico from the app and Telegram. A small launcher on Rozha's Mac (helper/
-- launcher.mjs, started by macOS at login) asks for a command every few seconds, starts Rico in real
-- or practice mode or stops him, and says how it went. Rico's own check-ins say which mode he is in.
alter table public.app_rr_helper add column if not exists mode text check (mode is null or mode in ('real','practice'));
alter table public.app_rr_helper add column if not exists launcher_seen timestamptz;
alter table public.app_rr_helper add column if not exists command text check (command is null or command in ('real','practice','stop'));
alter table public.app_rr_helper add column if not exists command_by text check (command_by is null or command_by in ('rozha','yunis','telegram'));
alter table public.app_rr_helper add column if not exists command_at timestamptz;
alter table public.app_rr_helper add column if not exists launch_result text check (launch_result is null or char_length(launch_result) <= 400);
alter table public.app_rr_helper add column if not exists launch_at timestamptz;

drop trigger if exists app_signal_receipts_helper on public.app_rr_helper;
create trigger app_signal_receipts_helper after update on public.app_rr_helper for each row
  when (old.signed_in is distinct from new.signed_in or old.stopped is distinct from new.stopped or old.auto_approve is distinct from new.auto_approve
    or old.mode is distinct from new.mode or old.command is distinct from new.command or old.launch_result is distinct from new.launch_result
    or (old.last_seen is null) <> (new.last_seen is null) or old.last_seen < now() - interval '2 minutes'
    or (old.launcher_seen is null) <> (new.launcher_seen is null) or old.launcher_seen < now() - interval '2 minutes')
  execute function public.app_signal_bump('receipts');
