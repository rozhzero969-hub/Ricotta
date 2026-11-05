-- 2026-11-10: Transfers between storages, moved in Ricotta Restaurant by Rico (like receipts).
-- One transfer is always one storage to one other storage ("Move between storages" there). It is
-- made in the app or on Telegram, checked against the stock Rico last read, filled in by Rico and
-- photographed, and only moved after Rozha (or Yunis, when given Transfers) approves it.

-- Yunis may be given Transfers in Admin > Access (off unless Rozha turns it on).
alter table public.app_accounts drop constraint if exists app_accounts_roles_known;
alter table public.app_accounts add constraint app_accounts_roles_known check (roles is null or (cardinality(roles) <= 12 and
  roles <@ array['history','manage','catalog','record','assistant','send','exports','notify','receipts','transfers']::text[]));

-- draft -> queued (sent to Rico) -> filling -> review (photo waiting for approval) -> approved ->
-- moving -> moved, or problem / cancelled. Lines: [{item, unit, qty}], names exactly as in Ricotta
-- Restaurant. yesterday: "Record for yesterday" (counts on the day before; never earlier).
create table if not exists public.app_rr_transfers (
  id uuid primary key default gen_random_uuid(),
  created_by text not null check (created_by in ('rozha','yunis')),
  source text not null default 'app' check (source in ('app','telegram')),
  status text not null default 'draft' check (status in ('draft','queued','filling','review','approved','moving','moved','problem','cancelled')),
  from_zone text check (from_zone is null or char_length(from_zone) between 1 and 80),
  to_zone text check (to_zone is null or char_length(to_zone) between 1 and 80),
  yesterday boolean not null default false,
  for_day date,
  lines jsonb not null default '[]' check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 120),
  warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  mode text check (mode is null or mode in ('real','practice')),
  problem text check (problem is null or char_length(problem) <= 500),
  result jsonb,
  photos jsonb not null default '[]' check (jsonb_typeof(photos) = 'array'),
  log jsonb not null default '[]' check (jsonb_typeof(log) = 'array'),
  approved_by text check (approved_by is null or approved_by in ('rozha','yunis')),
  approved_at timestamptz,
  sent_at timestamptz,
  moved_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Never from a storage to itself, never the two Breakfast storages (not used by the restaurant).
  constraint app_rr_transfers_two_zones check (from_zone is null or to_zone is null or from_zone <> to_zone),
  constraint app_rr_transfers_no_breakfast check (coalesce(from_zone, '') !~* 'breakfast' and coalesce(to_zone, '') !~* 'breakfast'),
  -- A person always approves before anything moves.
  constraint app_rr_transfers_person_approves check (status not in ('approved','moving','moved') or (approved_by in ('rozha','yunis') and approved_at is not null))
);
create index if not exists app_rr_transfers_status on public.app_rr_transfers(status, updated_at);
create index if not exists app_rr_transfers_created on public.app_rr_transfers(created_at desc);
alter table public.app_rr_transfers enable row level security;
revoke all on public.app_rr_transfers from public, anon, authenticated;
grant all on public.app_rr_transfers to service_role;

-- Rico takes the next transfer the way he takes receipts: approved ones first, then the oldest sent.
create or replace function public.app_internal_rr_claim_transfer(p_mode text default null)
returns setof public.app_rr_transfers language plpgsql set search_path = '' as $$
declare t public.app_rr_transfers;
begin
 if (select stopped from public.app_rr_helper where id) then return; end if;
 select * into t from public.app_rr_transfers
  where status in ('approved','queued')
  order by case status when 'approved' then 0 else 1 end, coalesce(sent_at, created_at)
  limit 1 for update skip locked;
 if t.id is null then return; end if;
 update public.app_rr_transfers set status = case when t.status = 'approved' then 'moving' else 'filling' end,
   mode = case when t.status = 'queued' and p_mode in ('real','practice') then p_mode else mode end,
   version = version + 1, updated_at = now() where id = t.id returning * into t;
 update public.app_rr_helper set busy_with = t.id where id;
 return next t;
end $$;
revoke all on function public.app_internal_rr_claim_transfer(text) from public, anon, authenticated;
grant execute on function public.app_internal_rr_claim_transfer(text) to service_role;

-- What Rico did (Record > Rico): transfers' steps too, marked as transfers.
alter table public.app_rr_events add column if not exists what text not null default 'receipt' check (what in ('receipt','transfer'));
create or replace function public.app_rr_transfer_event() returns trigger language plpgsql set search_path = '' as $$
begin
 if new.status = 'draft' or (tg_op = 'UPDATE' and new.status is not distinct from old.status) then return null; end if;
 insert into public.app_rr_events (what, kind, status, receipt_id, supplier, source, mode, actor, text)
 values ('transfer', 'status', new.status, new.id, left(coalesce(new.from_zone, '') || ' → ' || coalesce(new.to_zone, ''), 200), left(new.source, 20), new.mode,
   left(coalesce(new.log -> -1 ->> 'who', 'rico'), 40), case when new.status = 'problem' then left(new.problem, 500) end);
 return null;
end $$;
drop trigger if exists app_rr_transfer_event on public.app_rr_transfers;
create trigger app_rr_transfer_event after insert or update of status on public.app_rr_transfers for each row execute function public.app_rr_transfer_event();

-- A transfer moving along wakes the open apps (the same live signal as receipts).
drop trigger if exists app_signal_transfers on public.app_rr_transfers;
create trigger app_signal_transfers after insert or update or delete on public.app_rr_transfers for each statement execute function public.app_signal_bump('receipts');

-- Kept 60 days like receipts; one left half way for a day is a problem, never retried.
create or replace function public.app_internal_rr_cleanup(p_now timestamptz default now())
returns void language plpgsql set search_path = '' as $$
begin
 delete from public.app_rr_receipts where created_at < p_now - interval '60 days';
 delete from public.app_rr_transfers where created_at < p_now - interval '60 days';
 delete from public.app_rr_events where at < p_now - interval '60 days';
 update public.app_rr_receipts set status = 'problem', problem = 'Rico stopped in the middle (the Mac was closed). Check Ricotta Restaurant before sending it again.', updated_at = now()
  where status in ('filling','saving') and updated_at < p_now - interval '1 day';
 update public.app_rr_transfers set status = 'problem', problem = 'Rico stopped in the middle (the Mac was closed). Check Recent transfers in Ricotta Restaurant before sending it again.', updated_at = now()
  where status in ('filling','moving') and updated_at < p_now - interval '1 day';
end $$;
revoke all on function public.app_internal_rr_cleanup(timestamptz) from public, anon, authenticated;
grant execute on function public.app_internal_rr_cleanup(timestamptz) to service_role;
