-- Retire themes, custom tabs and Face ID while preserving PIN sessions and business data.
create or replace function public.app_internal_cleanup()
returns void language plpgsql set search_path = '' as $$
begin
 perform public.app_internal_monthly_cleanup();
 delete from public.app_login_attempts where attempted_at<now()-interval '2 days';
 delete from public.app_sessions where coalesce(revoked_at,expires_at)<now()-interval '2 days';
 delete from public.app_devices where not logged_in and coalesce(last_seen,updated_at)<now()-interval '30 days';
 delete from public.app_assistant_alerts where sent_at<now()-interval '30 days';
 delete from public.app_assistant_usage where created_at<now()-interval '90 days';
 delete from public.app_recovery_tickets where expires_at<now();
 delete from public.app_rico_inbox where created_at<now()-interval '30 days';
 delete from public.app_notes where created_at<now()-interval '60 days';
end $$;
revoke all on function public.app_internal_cleanup() from public,anon,authenticated;
grant execute on function public.app_internal_cleanup() to service_role;
drop function if exists public.app_internal_register_passkey(text,text,text,integer,text);
drop function if exists public.app_internal_reserve_passkey_challenge(text,text,text,text,timestamptz);
drop table if exists public.app_passkey_challenges;
drop table if exists public.app_passkeys;
alter table public.app_accounts drop column if exists theme,drop column if exists auto_theme,drop column if exists tabs;
