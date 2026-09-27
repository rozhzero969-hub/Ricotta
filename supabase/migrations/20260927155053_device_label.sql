-- What each device is ("iPhone 16/17 Pro Max|App", "Windows PC|Chrome"),
-- reported by the app, so the Devices screen can tell a phone from a computer.
alter table public.app_devices add column label text check (label is null or char_length(label) <= 80);
