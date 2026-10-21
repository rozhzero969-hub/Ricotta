-- Admin -> PINs: Rozha gives herself or Yunis a new PIN (the api checks her current PIN first and
-- refuses weak ones). The two PINs must differ, because a PIN alone says who is signing in. The new
-- PIN signs that account out everywhere except the session making the change.
create or replace function public.app_internal_set_pin(p_account text, p_pin text, p_keep_session uuid)
returns text language plpgsql security definer set search_path = 'public', 'extensions', 'pg_temp' as $$
declare keep_device text;
begin
  if p_account is null or p_account not in ('rozha', 'yunis') or p_pin is null or p_pin !~ '^[0-9]{6}$' then return 'invalid'; end if;
  if exists (select 1 from public.app_accounts where id <> p_account and extensions.crypt(p_pin, pin_hash) = pin_hash) then return 'duplicate'; end if;
  update public.app_accounts set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)), updated_at = now() where id = p_account;
  if not found then return 'invalid'; end if;
  select device_id into keep_device from public.app_sessions where id = p_keep_session;
  update public.app_sessions set revoked_at = now() where account = p_account and revoked_at is null and id is distinct from p_keep_session;
  update public.app_devices set logged_in = false, updated_at = now() where account = p_account and logged_in and id is distinct from keep_device;
  return 'ok';
end $$;
revoke all on function public.app_internal_set_pin(text, text, uuid) from public, anon, authenticated;
grant execute on function public.app_internal_set_pin(text, text, uuid) to service_role;
