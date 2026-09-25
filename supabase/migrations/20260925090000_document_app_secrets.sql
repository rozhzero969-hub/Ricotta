-- Codifies app_secrets, which already existed live (holding cron_secret,
-- vapid_public, vapid_private, gemini_api_key, groq_api_key) but had no
-- migration file of its own -- a schema-drift gap found in a security audit.
-- This does not change its behaviour: it was already RLS-on with zero
-- policies and grants limited to service_role/postgres, verified directly
-- against the live database before writing this. `if not exists` / re-grants
-- below are safe no-ops on a project where the table already matches.
create table if not exists public.app_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
-- No policies: only service_role (used by the Edge Functions) and postgres
-- (migrations/dashboard) can touch this table. anon and authenticated have
-- no grants at all, so RLS policies are unnecessary -- they would never be
-- evaluated for those roles regardless.
revoke all on public.app_secrets from anon, authenticated;
grant all on public.app_secrets to service_role;
