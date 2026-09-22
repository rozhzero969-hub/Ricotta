-- Follow-up hardening after moving server-only tables into the public schema.
-- Browser roles remain revoked; only the Edge Function service role is granted.
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
create index if not exists app_items_unit_idx on public.app_items(unit_id);
create index if not exists app_order_lines_supplier_idx on public.app_order_lines(supplier_id);
create index if not exists app_sessions_role_idx on public.app_sessions(role);
