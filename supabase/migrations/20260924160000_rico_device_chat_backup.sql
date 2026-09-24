-- Keep Rico conversations across app restarts, scoped to the signed-in device
-- and PIN role. Removing a device also removes its saved conversations.
create table if not exists public.app_assistant_chats (
  device_id text not null references public.app_devices(id) on delete cascade,
  role text not null check (role in ('admin', 'staff')),
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (device_id, role)
);

alter table public.app_assistant_chats enable row level security;
revoke all on public.app_assistant_chats from public, anon, authenticated;
grant select, insert, update, delete on public.app_assistant_chats to service_role;
