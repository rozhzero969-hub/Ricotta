-- Supports the app_sessions.role foreign key and removes the only relevant
-- performance-advisor finding without changing application behavior.
create index if not exists app_sessions_role_idx on public.app_sessions (role);
