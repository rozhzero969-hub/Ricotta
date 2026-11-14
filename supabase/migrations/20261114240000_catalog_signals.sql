-- 2026-11-14: Check now shows the new lists at once. When Rico writes new lists from Ricotta Restaurant
-- (Check now, or his own read every 10 minutes) and anything in them changed (items, units, storages,
-- suppliers, stock), every open app hears it straight away: 'data' reloads the items with their linked
-- stock lines on the Order screen, 'receipts' reloads Receipts, Transfers and Stock. A read that found
-- nothing new (only the read time moved) wakes nobody.
drop trigger if exists app_signal_catalog_data_insert on public.app_rr_catalog;
create trigger app_signal_catalog_data_insert after insert on public.app_rr_catalog for each row
  execute function public.app_signal_bump('data');
drop trigger if exists app_signal_catalog_receipts_insert on public.app_rr_catalog;
create trigger app_signal_catalog_receipts_insert after insert on public.app_rr_catalog for each row
  execute function public.app_signal_bump('receipts');
drop trigger if exists app_signal_catalog_data on public.app_rr_catalog;
create trigger app_signal_catalog_data after update on public.app_rr_catalog for each row
  when ((old.data - 'stockAt') is distinct from (new.data - 'stockAt'))
  execute function public.app_signal_bump('data');
drop trigger if exists app_signal_catalog_receipts on public.app_rr_catalog;
create trigger app_signal_catalog_receipts after update on public.app_rr_catalog for each row
  when ((old.data - 'stockAt') is distinct from (new.data - 'stockAt'))
  execute function public.app_signal_bump('receipts');
