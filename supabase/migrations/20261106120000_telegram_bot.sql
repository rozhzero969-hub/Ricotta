-- 2026-11-06: the Ricotta Helper bot on Telegram (Rico). It answers only the Telegram chat Rozha linked
-- from Settings with a one-time code; it reports receipts (photo to approve with Approve / Cancel,
-- saved with the finance number, stopped with the reason, "the Mac is off") and makes receipts step by step.

-- The linked chat (one per account; only Rozha for now).
create table if not exists public.app_tg_links (
  account text primary key check (account in ('rozha','yunis')),
  chat_id bigint not null unique,
  linked_at timestamptz not null default now()
);
-- One-time codes from Settings > Connect Telegram, valid 15 minutes.
create table if not exists public.app_tg_codes (
  code text primary key check (code ~ '^[A-Za-z0-9]{16,40}$'),
  account text not null check (account in ('rozha','yunis')),
  expires_at timestamptz not null
);
-- Where a linked chat is in making a receipt (supplier, invoice, ... items), and the last "Mac is off" note.
create table if not exists public.app_tg_state (
  chat_id bigint primary key,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.app_tg_links enable row level security;
alter table public.app_tg_codes enable row level security;
alter table public.app_tg_state enable row level security;
revoke all on public.app_tg_links, public.app_tg_codes, public.app_tg_state from public, anon, authenticated;
grant all on public.app_tg_links, public.app_tg_codes, public.app_tg_state to service_role;

-- A receipt can now come from Telegram (already allowed: source 'telegram'); a Rico receipt still always
-- waits for a person. Old codes and stale half-made receipts in a chat are cleared every night.
create or replace function public.app_internal_tg_cleanup()
returns void language plpgsql set search_path = '' as $$
begin
 delete from public.app_tg_codes where expires_at < now();
 update public.app_tg_state set data = data - 'draft' where updated_at < now() - interval '2 days' and data ? 'draft';
end $$;
revoke all on function public.app_internal_tg_cleanup() from public, anon, authenticated;
grant execute on function public.app_internal_tg_cleanup() to service_role;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ricotta-telegram-cleanup', '43 0 * * *', $sql$select public.app_internal_tg_cleanup()$sql$);
  end if;
end $$;
