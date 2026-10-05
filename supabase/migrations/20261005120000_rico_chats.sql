-- Rico's chat history: each account's own conversations, so a chat can be reopened later and on
-- the person's other phone. Only the api function (service role) reads or writes them, always
-- for the signed-in account. Old chats are removed after 90 days (see app_rico_chats_prune).
create table public.app_rico_chats (
  id uuid primary key,
  account text not null references public.app_accounts(id) on delete cascade,
  title text not null default '',
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index app_rico_chats_account_updated on public.app_rico_chats (account, updated_at desc);
alter table public.app_rico_chats enable row level security;
revoke all on public.app_rico_chats from anon, authenticated;
grant all on public.app_rico_chats to service_role;

-- Keeps each account to its newest 60 chats and nothing older than 90 days.
create or replace function public.app_rico_chats_prune(p_account text)
returns void language sql security invoker set search_path = public as $$
  delete from public.app_rico_chats where account = p_account and (updated_at < now() - interval '90 days'
    or id in (select id from public.app_rico_chats where account = p_account order by updated_at desc offset 60));
$$;
revoke all on function public.app_rico_chats_prune(text) from public, anon, authenticated;
grant execute on function public.app_rico_chats_prune(text) to service_role;
