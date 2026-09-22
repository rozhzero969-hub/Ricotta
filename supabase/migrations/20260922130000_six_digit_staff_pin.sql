-- Both shared roles use six digits.  Changing the staff PIN revokes every
-- existing opaque session, so old four-digit sign-ins cannot remain active.
create or replace function public.app_internal_set_pins(p_admin_pin text, p_staff_pin text)
returns void language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_admin_pin !~ '^[0-9]{6}$' or p_staff_pin !~ '^[0-9]{6}$' or p_admin_pin = p_staff_pin then
    raise exception 'invalid PIN format';
  end if;
  update public.app_roles
  set pin_hash = extensions.crypt(case role when 'admin' then p_admin_pin else p_staff_pin end, extensions.gen_salt('bf',12)),
      updated_at = now();
  update public.app_sessions set revoked_at=now() where revoked_at is null;
end;
$$;

-- User-requested staff PIN.  Do not add it to client code or configuration.
update public.app_roles
set pin_hash = extensions.crypt('200777', extensions.gen_salt('bf',12)), updated_at=now()
where role='staff';
update public.app_sessions set revoked_at=now() where revoked_at is null;

revoke execute on function public.app_internal_set_pins(text,text) from public, anon, authenticated;
grant execute on function public.app_internal_set_pins(text,text) to service_role;
