-- Rico's memories and routines (2026-11-14).
-- Memories: what a person taught Rico ("taught", as before) and what he picked up while chatting
-- ("learned", e.g. how this person likes answers). Kept per account; the API caps them at 60 each.
alter table public.app_rico_rules add column if not exists source text not null default 'taught'
  check (source in ('taught', 'learned'));
create index if not exists app_rico_rules_account_idx on public.app_rico_rules (account, created_at);

-- Routines: a reminder, or an order Rico prepares by himself, at a time on some weekdays (Baghdad time),
-- or a one-off reminder at run_at ("in 10 minutes", "tomorrow at 9"), removed once it has fired.
-- Run by the send-push function's every-minute tick; last_run_day makes each one happen once a day.
-- Rico never sends anything to a supplier: a prepared order waits in the person's inbox for them.
create table if not exists public.app_rico_routines (
  id uuid primary key default gen_random_uuid(),
  account text not null check (account in ('rozha', 'yunis')),
  kind text not null check (kind in ('remind', 'prepare_order')),
  text text not null check (char_length(text) between 1 and 200),
  supplier_ids text[] not null default '{}' check (cardinality(supplier_ids) <= 5),
  time text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  days smallint[] not null default '{0,1,2,3,4,5,6}' check (cardinality(days) between 1 and 7 and days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  enabled boolean not null default true,
  last_run_day date,
  run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'prepare_order' or cardinality(supplier_ids) between 1 and 5),
  check (run_at is null or kind = 'remind')
);
create index if not exists app_rico_routines_account_idx on public.app_rico_routines (account, created_at);
alter table public.app_rico_routines enable row level security;
revoke all on public.app_rico_routines from public, anon, authenticated;
grant all on public.app_rico_routines to service_role;

-- A prepared order rides along with its inbox message (the lines to put in the order on a tap).
alter table public.app_rico_inbox add column if not exists payload jsonb
  check (payload is null or (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 20000));

-- Inbox kinds were a fixed list; routine messages add two. Any old fixed list is replaced by a plain shape check.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.app_rico_inbox'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.app_rico_inbox drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.app_rico_inbox add constraint app_rico_inbox_kind_shape check (kind ~ '^[a-z_-]{1,30}$') not valid;
