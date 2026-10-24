-- PIN validation, attempt completion, session issuance and device binding commit together.
-- These account locks are also taken by app_internal_set_pin: a login is either fully
-- before a PIN change (and revoked by it) or after it (and must use the new PIN).
create function public.app_internal_start_session(
  p_code text, p_token_hash text, p_device text, p_label text, p_version text, p_attempt_ids bigint[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare matched text; account_name text; expiry timestamptz; completed integer;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or (p_device is not null and length(p_device) not between 1 and 120)
    or length(p_label) > 80 or length(p_version) > 40
    or coalesce(cardinality(p_attempt_ids),0) <> 2 or p_attempt_ids[1] is null or p_attempt_ids[2] is null
    or p_attempt_ids[1] = p_attempt_ids[2] then raise exception 'Invalid session request'; end if;
  perform id from public.app_accounts order by id for update;
  matched := public.app_internal_match_code(p_code);
  if matched is null then return jsonb_build_object('error','invalid_credentials'); end if;
  update public.app_login_attempts set succeeded = true where id = any(p_attempt_ids) and not succeeded;
  get diagnostics completed = row_count;
  if completed <> 2 then raise exception 'Invalid login reservation'; end if;
  -- Client-provided device ids remain identifiers, not credentials. Serialized account locks
  -- prevent two different accounts from both claiming an unused id at the same time.
  if p_device is not null and exists(select 1 from public.app_sessions
    where device_id = p_device and account <> matched and revoked_at is null and expires_at > now()) then
    return jsonb_build_object('error','device_in_use');
  end if;
  expiry := now() + interval '18 hours';
  insert into public.app_sessions(token_hash,account,device_id,expires_at)
    values(p_token_hash,matched,p_device,expiry);
  if p_device is not null then
    insert into public.app_devices as d(id,account,label,app_version,logged_in,last_login,last_seen,updated_at)
      values(p_device,matched,p_label,p_version,true,now(),now(),now())
      on conflict(id) do update set account=excluded.account,label=excluded.label,
        app_version=coalesce(excluded.app_version,d.app_version),logged_in=true,
        last_login=excluded.last_login,last_seen=excluded.last_seen,updated_at=excluded.updated_at,
        handled_command=coalesce(d.command->>'id',d.handled_command);
  end if;
  select name into account_name from public.app_accounts where id = matched;
  return jsonb_build_object('account',matched,'name',account_name,'expiresAt',expiry);
end $$;
revoke all on function public.app_internal_start_session(text,text,text,text,text,bigint[]) from public,anon,authenticated;
grant execute on function public.app_internal_start_session(text,text,text,text,text,bigint[]) to service_role;
