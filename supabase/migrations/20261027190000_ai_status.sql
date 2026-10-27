-- ROZH-25: how each of Rico's AI services answered last, for Admin › Rico: Claude Haiku (main), Google
-- Gemini and Groq (backups). One row per service, written by the api after each reply.
create table if not exists public.app_ai_status (
  provider text primary key check (provider in ('anthropic', 'gemini', 'groq')),
  state text not null check (state in ('working', 'key_rejected', 'no_funds', 'busy', 'failed', 'model_unavailable', 'not_configured')),
  at timestamptz not null default now()
);
alter table public.app_ai_status enable row level security;
revoke all on public.app_ai_status from public, anon, authenticated;
grant all on public.app_ai_status to service_role;
