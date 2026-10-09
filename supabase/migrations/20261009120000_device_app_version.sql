-- Each phone reports which version of the app it runs (sent as x-app-version),
-- so Rozha's Devices screen can show who is up to date.
alter table public.app_devices add column if not exists app_version text;
alter table public.app_devices drop constraint if exists app_devices_app_version_check;
alter table public.app_devices add constraint app_devices_app_version_check
  check (app_version is null or app_version ~ '^[A-Za-z0-9._-]{1,40}$');
