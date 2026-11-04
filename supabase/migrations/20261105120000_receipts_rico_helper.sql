-- 2026-11-05: Receipts, entered in Ricotta Restaurant by Rico on Rozha's Mac.
-- Ricotta Restaurant is another team's app with no API for us, so Rico (a program on the Mac, see
-- helper/) fills in its New receipt page the way a person does, checks it, photographs it and reports
-- back. This app only keeps the receipts, the lists Rico reads from Ricotta Restaurant and his state.

-- Yunis may be given Receipts in Admin > Access.
alter table public.app_accounts drop constraint if exists app_accounts_roles_known;
alter table public.app_accounts add constraint app_accounts_roles_known check (roles is null or (cardinality(roles) <= 12 and
  roles <@ array['history','manage','catalog','record','assistant','send','exports','notify','receipts']::text[]));

-- What Rico last read from Ricotta Restaurant: suppliers, zones and the purchased items with their
-- units, exactly as written there. One row, replaced whole each time he starts.
create table if not exists public.app_rr_catalog (
  id boolean primary key default true check (id),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);

-- Rico on the Mac: when he last checked in, and the switches Rozha sets in Settings.
create table if not exists public.app_rr_helper (
  id boolean primary key default true check (id),
  last_seen timestamptz,
  version text check (version is null or char_length(version) <= 40),
  signed_in boolean not null default false,
  busy_with uuid,
  auto_approve boolean not null default false,
  stopped boolean not null default false,
  big_total bigint not null default 1000000 check (big_total > 0),
  price_jump integer not null default 30 check (price_jump between 1 and 500),
  rate_min integer not null default 1500 check (rate_min > 0),
  rate_max integer not null default 1800 check (rate_max >= rate_min),
  photos_cleaned date
);
insert into public.app_rr_helper(id) values (true) on conflict (id) do nothing;

-- One receipt. draft -> queued (sent to Rico) -> filling -> review (photo waiting for approval)
-- -> approved -> saving -> saved, or problem / cancelled. Lines: [{item, unit, qty, cost}], names
-- exactly as in Ricotta Restaurant; cost is whole IQD, or whole dollars on a USD receipt.
create table if not exists public.app_rr_receipts (
  id uuid primary key default gen_random_uuid(),
  created_by text not null check (created_by in ('rozha','yunis')),
  source text not null default 'app' check (source in ('app','rico','telegram')),
  status text not null default 'draft' check (status in ('draft','queued','filling','review','approved','saving','saved','problem','cancelled')),
  supplier text check (supplier is null or char_length(supplier) between 1 and 200),
  invoice text check (invoice is null or invoice ~ '^[0-9]{1,30}$'),
  zone text not null default 'Main Storage' check (char_length(zone) between 1 and 80),
  currency text not null default 'IQD' check (currency in ('IQD','USD')),
  rate numeric(12,3) check (rate is null or rate > 0),
  delivery bigint check (delivery is null or delivery >= 0),
  lines jsonb not null default '[]' check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 120),
  total numeric(16,3),
  warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  problem text check (problem is null or char_length(problem) <= 500),
  finance jsonb,
  photos jsonb not null default '[]' check (jsonb_typeof(photos) = 'array'),
  log jsonb not null default '[]' check (jsonb_typeof(log) = 'array'),
  approved_by text check (approved_by is null or approved_by in ('rozha','yunis','auto')),
  approved_at timestamptz,
  sent_at timestamptz,
  saved_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists app_rr_receipts_status on public.app_rr_receipts(status, updated_at);
create index if not exists app_rr_receipts_created on public.app_rr_receipts(created_at desc);
-- The same invoice from the same supplier can only be on its way once.
create unique index if not exists app_rr_receipts_one_invoice on public.app_rr_receipts(supplier, invoice)
  where status in ('queued','filling','review','approved','saving','saved');

alter table public.app_rr_catalog enable row level security;
alter table public.app_rr_helper enable row level security;
alter table public.app_rr_receipts enable row level security;
revoke all on public.app_rr_catalog, public.app_rr_helper, public.app_rr_receipts from public, anon, authenticated;
grant all on public.app_rr_catalog, public.app_rr_helper, public.app_rr_receipts to service_role;

-- Rico's photos of Ricotta Restaurant, private; the API hands out short-lived links.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    values ('receipt-photos', 'receipt-photos', false, 3145728, array['image/jpeg','image/png'])
    on conflict (id) do nothing;
  end if;
end $$;

-- Rico takes the next receipt: the oldest approved one first (it only needs saving), then the oldest
-- queued one. Taking it and marking it is one step, so two Macs could never take the same receipt.
create or replace function public.app_internal_rr_claim()
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
   version = version + 1, updated_at = now() where id = r.id returning * into r;
 update public.app_rr_helper set busy_with = r.id where id;
 return next r;
end $$;
revoke all on function public.app_internal_rr_claim() from public, anon, authenticated;
grant execute on function public.app_internal_rr_claim() to service_role;

-- Receipts are kept 60 days, like orders and the Record (photos go with them, see the API).
create or replace function public.app_internal_rr_cleanup(p_now timestamptz default now())
returns void language plpgsql set search_path = '' as $$
begin
 delete from public.app_rr_receipts where created_at < p_now - interval '60 days';
 -- A receipt left half way for a day (the Mac closed mid-job) is shown as a problem, never retried.
 update public.app_rr_receipts set status = 'problem', problem = 'Rico stopped in the middle (the Mac was closed). Check Ricotta Restaurant before sending it again.', updated_at = now()
  where status in ('filling','saving') and updated_at < p_now - interval '1 day';
end $$;
revoke all on function public.app_internal_rr_cleanup(timestamptz) from public, anon, authenticated;
grant execute on function public.app_internal_rr_cleanup(timestamptz) to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ricotta-receipts-cleanup', '41 0 * * *', $sql$select public.app_internal_rr_cleanup()$sql$);
  end if;
end $$;

-- Live changes: a receipt moving along (or Rico checking in with news) wakes the open apps.
alter table public.app_signals drop constraint if exists app_signals_kind_check;
alter table public.app_signals add constraint app_signals_kind_check check (kind in ('data','draft','devices','admin','inbox','receipts'));
drop trigger if exists app_signal_receipts on public.app_rr_receipts;
create trigger app_signal_receipts after insert or update or delete on public.app_rr_receipts for each statement execute function public.app_signal_bump('receipts');
drop trigger if exists app_signal_receipts_helper on public.app_rr_helper;
create trigger app_signal_receipts_helper after update on public.app_rr_helper for each row
  when (old.signed_in is distinct from new.signed_in or old.stopped is distinct from new.stopped or old.auto_approve is distinct from new.auto_approve
    or (old.last_seen is null) <> (new.last_seen is null) or old.last_seen < now() - interval '2 minutes')
  execute function public.app_signal_bump('receipts');
