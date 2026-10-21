-- Kitchen notes, repeat orders, the whole-order note, the secret code with its "Who are you?" answer,
-- and the WhatsApp message format are gone from the app (PINs are changed in Admin now, see
-- app_internal_set_pin). Their tables, columns, functions and stored hashes go too. None of them held
-- anything in use: 0 notes, 0 repeat orders, every order note empty.
drop function if exists public.app_internal_set_credentials(text, text, text);
drop function if exists public.app_internal_check_recovery_name(text);
drop function if exists public.app_internal_set_recovery_name(text);
drop function if exists public.app_internal_patch_draft_note(text, jsonb, text, text);
drop function if exists public.app_internal_save_order_note(text, timestamptz, text, jsonb, text);
drop table if exists public.app_recovery_tickets;
drop table if exists public.app_notes;
drop table if exists public.app_repeat_orders;
delete from public.app_secrets where key in ('recovery_code_hash', 'recovery_name_hash');
alter table public.app_accounts drop column if exists message_format;
alter table public.app_orders drop column if exists note;
alter table public.app_order_drafts drop column if exists note;

-- A six-digit code is a PIN or nothing.
create or replace function public.app_internal_match_code(p_code text)
returns text language plpgsql security definer set search_path = 'public', 'extensions', 'pg_temp' as $$
declare matched text;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then return null; end if;
  select id into matched from public.app_accounts where extensions.crypt(p_code, pin_hash) = pin_hash limit 1;
  return matched;
end $$;
revoke all on function public.app_internal_match_code(text) from public, anon, authenticated;
grant execute on function public.app_internal_match_code(text) to service_role;

-- The nightly clean-up, without the tables above.
create or replace function public.app_internal_cleanup()
returns void language plpgsql set search_path = '' as $$
begin
 perform public.app_internal_monthly_cleanup();
 delete from public.app_login_attempts where attempted_at<now()-interval '2 days';
 delete from public.app_sessions where coalesce(revoked_at,expires_at)<now()-interval '2 days';
 delete from public.app_devices where not logged_in and coalesce(last_seen,updated_at)<now()-interval '30 days';
 delete from public.app_assistant_alerts where sent_at<now()-interval '30 days';
 delete from public.app_assistant_usage where created_at<now()-interval '90 days';
 delete from public.app_rico_inbox where created_at<now()-interval '30 days';
end $$;
revoke all on function public.app_internal_cleanup() from public, anon, authenticated;
grant execute on function public.app_internal_cleanup() to service_role;
