-- The answer to "Who are you?" in the secret-code steps is no longer fixed:
-- it is stored as a bcrypt hash (starting as "rozha") and matched exactly,
-- case-sensitive, like the PINs. Rozha can change it on the same screen as
-- the PINs and the secret code.
insert into public.app_secrets (key, value)
values ('recovery_name_hash', extensions.crypt('rozha', extensions.gen_salt('bf', 12)))
on conflict (key) do nothing;

create function public.app_internal_check_recovery_name(p_name text)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (select 1 from public.app_secrets
    where key = 'recovery_name_hash' and extensions.crypt(coalesce(p_name, ''), value) = value);
$$;

create function public.app_internal_set_recovery_name(p_name text)
returns text language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_name is null or length(p_name) < 1 or length(p_name) > 40 or p_name <> btrim(p_name) then return 'invalid'; end if;
  update public.app_secrets set value = extensions.crypt(p_name, extensions.gen_salt('bf', 12)) where key = 'recovery_name_hash';
  delete from public.app_recovery_tickets;
  return 'ok';
end;
$$;

revoke execute on function public.app_internal_check_recovery_name(text), public.app_internal_set_recovery_name(text) from public, anon, authenticated;
grant execute on function public.app_internal_check_recovery_name(text), public.app_internal_set_recovery_name(text) to service_role;
