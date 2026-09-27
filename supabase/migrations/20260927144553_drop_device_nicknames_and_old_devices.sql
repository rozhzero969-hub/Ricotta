-- Devices no longer have nicknames: a phone is shown by the account signed
-- in there. Every device and sign-in from before the two-account update is
-- removed, so the Devices screen only lists phones that signed in to the new
-- app (those rows have an account). Push subscriptions of removed phones go
-- too; a phone that signs in again subscribes again.
alter table public.app_devices drop column nickname;
delete from public.app_devices where account is null;
delete from public.app_sessions where revoked_at is not null or expires_at < now();
delete from public.app_push_subscriptions
  where device_id is null or device_id not in (select id from public.app_devices);
