-- The database's size in bytes, for Admin (Rico answers Rozha's Admin questions with it).
create or replace function public.app_internal_db_size() returns bigint language sql stable set search_path = '' as $$
  select pg_database_size(current_database())::bigint
$$;
revoke all on function public.app_internal_db_size() from public, anon, authenticated;
grant execute on function public.app_internal_db_size() to service_role;
-- The size of the photo files (bytes), for Admin.
create or replace function public.app_internal_files_size() returns bigint language plpgsql stable set search_path = '' as $$
begin
  return (select coalesce(sum((metadata->>'size')::bigint), 0)::bigint from storage.objects);
end $$;
revoke all on function public.app_internal_files_size() from public, anon, authenticated;
grant execute on function public.app_internal_files_size() to service_role;
