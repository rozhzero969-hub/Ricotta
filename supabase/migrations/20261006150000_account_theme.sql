-- Each account's chosen colour theme is saved on the server, so it follows the
-- person to a new phone and the other account can show them in their own colours
-- (History, Devices, Record). Ricotta is the default.
alter table public.app_accounts
  add column if not exists theme text not null default 'ricotta'
  check (theme in ('ricotta', 'graphite', 'ocean', 'saffron', 'berry'));
