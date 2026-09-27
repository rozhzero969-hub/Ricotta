-- Covering indexes for the two account foreign keys (the database linter
-- flags them; they also make a device or session lookup by account cheap).
create index if not exists app_devices_account_idx on public.app_devices (account);
create index if not exists app_sessions_account_idx on public.app_sessions (account);
