-- Keep the public challenge endpoint bounded even under simultaneous requests.
create or replace function public.app_internal_reserve_passkey_challenge(
 p_token_hash text,p_challenge text,p_purpose text,p_account text,p_expires_at timestamptz
) returns boolean language plpgsql set search_path='' as $$
begin
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$'
  or p_purpose is null or p_purpose not in ('login','register')
  or (p_purpose='login' and p_account is not null)
  or (p_purpose='register' and (p_account is null or p_account not in ('rozha','yunis')))
  or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '5 minutes 10 seconds' then raise exception 'Invalid challenge'; end if;
 perform pg_advisory_xact_lock(hashtextextended('passkey-challenge-cap',0));
 delete from public.app_passkey_challenges where expires_at<=now();
 if (select count(*) from public.app_passkey_challenges)>=200 then return false; end if;
 insert into public.app_passkey_challenges(token_hash,challenge,purpose,account,expires_at)
  values(p_token_hash,p_challenge,p_purpose,p_account,p_expires_at);
 return true;
end $$;
revoke all on function public.app_internal_reserve_passkey_challenge(text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.app_internal_reserve_passkey_challenge(text,text,text,text,timestamptz) to service_role;
