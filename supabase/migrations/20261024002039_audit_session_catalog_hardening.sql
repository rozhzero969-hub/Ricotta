-- Serialize changes across both PINs before testing uniqueness. Previously two concurrent
-- requests could both pass the duplicate check and give both accounts the same PIN.
-- The privileged function also verifies its admin session at commit time, and writes its
-- security audit event in the same transaction as the PIN/session updates.
create or replace function public.app_internal_set_pin(p_account text, p_pin text, p_keep_session uuid)
returns text language plpgsql security definer set search_path = 'public', 'extensions', 'pg_temp' as $$
declare keep_device text;
begin
  if p_account is null or p_account not in ('rozha', 'yunis') or p_pin is null or p_pin !~ '^[0-9]{6}$' then return 'invalid'; end if;
  perform id from public.app_accounts order by id for update;
  select device_id into keep_device from public.app_sessions
    where id = p_keep_session and account = 'rozha' and revoked_at is null and expires_at > now() for update;
  if not found then return 'forbidden'; end if;
  if exists (select 1 from public.app_accounts where id <> p_account and extensions.crypt(p_pin, pin_hash) = pin_hash) then return 'duplicate'; end if;
  update public.app_accounts set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)), updated_at = now() where id = p_account;
  if not found then return 'invalid'; end if;
  update public.app_sessions set revoked_at = now() where account = p_account and revoked_at is null and id is distinct from p_keep_session;
  update public.app_devices set logged_in = false, updated_at = now() where account = p_account and logged_in and id is distinct from keep_device;
  insert into public.app_audit_events(id,actor,device_id,action,payload)
    values('audit_' || extensions.gen_random_uuid()::text,'rozha',keep_device,'change_pin',jsonb_build_object('account',p_account));
  return 'ok';
end $$;
revoke all on function public.app_internal_set_pin(text, text, uuid) from public, anon, authenticated;
grant execute on function public.app_internal_set_pin(text, text, uuid) to service_role;
