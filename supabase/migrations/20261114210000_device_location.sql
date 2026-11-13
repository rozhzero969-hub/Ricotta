-- Where each device was when it last signed in (only the latest sign-in is kept): the address, and the
-- place ipinfo.io gives for it (city, region, country, network and the address's time zone), the
-- phone's own time zone, and whether it looks like a VPN (signin_vpn; reason "org" = a hosting or VPN
-- network, "tz" = the phone's time zone is not the address's). Only the API (service role) reads or
-- writes app_devices, as before.
alter table public.app_devices
  add column if not exists signin_ip text,
  add column if not exists signin_city text,
  add column if not exists signin_region text,
  add column if not exists signin_country text,
  add column if not exists signin_org text,
  add column if not exists signin_ip_tz text,
  add column if not exists signin_device_tz text,
  add column if not exists signin_vpn boolean,
  add column if not exists signin_vpn_reason text,
  add column if not exists signin_at_place timestamptz;
alter table public.app_devices drop constraint if exists app_devices_signin_place_check;
alter table public.app_devices add constraint app_devices_signin_place_check check (
  (signin_ip is null or length(signin_ip) <= 45) and (signin_city is null or length(signin_city) <= 80)
  and (signin_region is null or length(signin_region) <= 80) and (signin_country is null or length(signin_country) <= 2)
  and (signin_org is null or length(signin_org) <= 120) and (signin_ip_tz is null or length(signin_ip_tz) <= 40)
  and (signin_device_tz is null or length(signin_device_tz) <= 40)
  and (signin_vpn_reason is null or signin_vpn_reason in ('org', 'tz')));
