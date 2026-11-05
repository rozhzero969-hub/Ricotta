-- 2026-11-08: each receipt remembers whether Rico ran it for real or in practice mode (shown and
-- filterable in the Receipts tab). Set when Rico takes the receipt. Older practice runs are marked
-- from their message. A repeated start/stop result (same text, new time) also wakes the open apps.
alter table public.app_rr_receipts add column if not exists mode text check (mode is null or mode in ('real','practice'));
update public.app_rr_receipts set mode = 'practice' where mode is null and problem like 'Practice run%';
update public.app_rr_receipts set mode = 'real' where mode is null and status in ('saving','saved');

drop trigger if exists app_signal_receipts_helper on public.app_rr_helper;
create trigger app_signal_receipts_helper after update on public.app_rr_helper for each row
  when (old.signed_in is distinct from new.signed_in or old.stopped is distinct from new.stopped or old.auto_approve is distinct from new.auto_approve
    or old.mode is distinct from new.mode or old.command is distinct from new.command or old.launch_result is distinct from new.launch_result
    or old.launch_at is distinct from new.launch_at
    or (old.last_seen is null) <> (new.last_seen is null) or old.last_seen < now() - interval '2 minutes'
    or (old.launcher_seen is null) <> (new.launcher_seen is null) or old.launcher_seen < now() - interval '2 minutes')
  execute function public.app_signal_bump('receipts');

-- Rico takes a receipt in the mode he is running in.
drop function if exists public.app_internal_rr_claim();
create or replace function public.app_internal_rr_claim(p_mode text default null)
returns setof public.app_rr_receipts language plpgsql set search_path = '' as $$
declare r public.app_rr_receipts;
begin
 if (select stopped from public.app_rr_helper where id) then return; end if;
 select * into r from public.app_rr_receipts
  where status in ('approved','queued')
  order by case status when 'approved' then 0 else 1 end, coalesce(sent_at, created_at)
  limit 1 for update skip locked;
 if r.id is null then return; end if;
 update public.app_rr_receipts set status = case when r.status = 'approved' then 'saving' else 'filling' end,
   mode = case when r.status = 'queued' and p_mode in ('real','practice') then p_mode else mode end,
   version = version + 1, updated_at = now() where id = r.id returning * into r;
 update public.app_rr_helper set busy_with = r.id where id;
 return next r;
end $$;
revoke all on function public.app_internal_rr_claim(text) from public, anon, authenticated;
grant execute on function public.app_internal_rr_claim(text) to service_role;

-- What Rico did, for the Record tab and the bot: every step of a receipt, each Start / Stop pressed,
-- and how each start or stop went. Written by triggers, so nothing is missed. Kept 60 days.
create table if not exists public.app_rr_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('status','command','launch')),
  status text check (status is null or char_length(status) <= 20),
  receipt_id uuid,
  supplier text check (supplier is null or char_length(supplier) <= 200),
  invoice text check (invoice is null or char_length(invoice) <= 30),
  source text check (source is null or char_length(source) <= 20),
  mode text check (mode is null or mode in ('real','practice')),
  actor text check (actor is null or char_length(actor) <= 40),
  text text check (text is null or char_length(text) <= 500)
);
alter table public.app_rr_events enable row level security;
revoke all on public.app_rr_events from public, anon, authenticated;
create index if not exists app_rr_events_at on public.app_rr_events (at desc);

create or replace function public.app_rr_receipt_event() returns trigger language plpgsql set search_path = '' as $$
begin
 if new.status = 'draft' or (tg_op = 'UPDATE' and new.status is not distinct from old.status) then return null; end if;
 insert into public.app_rr_events (kind, status, receipt_id, supplier, invoice, source, mode, actor, text)
 values ('status', new.status, new.id, left(new.supplier, 200), left(new.invoice, 30), left(new.source, 20), new.mode,
   left(coalesce(new.log -> -1 ->> 'who', 'rico'), 40), case when new.status = 'problem' then left(new.problem, 500) end);
 return null;
end $$;
drop trigger if exists app_rr_receipt_event on public.app_rr_receipts;
create trigger app_rr_receipt_event after insert or update of status on public.app_rr_receipts for each row execute function public.app_rr_receipt_event();

create or replace function public.app_rr_helper_event() returns trigger language plpgsql set search_path = '' as $$
begin
 if new.command is not null and new.command is distinct from old.command then
  insert into public.app_rr_events (kind, status, actor) values ('command', new.command, left(new.command_by, 40));
 end if;
 if new.launch_at is distinct from old.launch_at and new.launch_result is not null then
  insert into public.app_rr_events (kind, mode, text) values ('launch', new.mode, left(new.launch_result, 500));
 end if;
 return null;
end $$;
drop trigger if exists app_rr_helper_event on public.app_rr_helper;
create trigger app_rr_helper_event after update on public.app_rr_helper for each row execute function public.app_rr_helper_event();

-- A live screenshot asked for on Telegram: Rico takes it on his next look (within a second or two).
alter table public.app_rr_helper add column if not exists shot_want timestamptz;
alter table public.app_rr_helper add column if not exists shot_chat bigint;

create or replace function public.app_internal_rr_cleanup(p_now timestamptz default now())
returns void language plpgsql set search_path = '' as $$
begin
 delete from public.app_rr_receipts where created_at < p_now - interval '60 days';
 delete from public.app_rr_events where at < p_now - interval '60 days';
 -- A receipt left half way for a day (the Mac closed mid-job) is shown as a problem, never retried.
 update public.app_rr_receipts set status = 'problem', problem = 'Rico stopped in the middle (the Mac was closed). Check Ricotta Restaurant before sending it again.', updated_at = now()
  where status in ('filling','saving') and updated_at < p_now - interval '1 day';
end $$;
revoke all on function public.app_internal_rr_cleanup(timestamptz) from public, anon, authenticated;
grant execute on function public.app_internal_rr_cleanup(timestamptz) to service_role;
