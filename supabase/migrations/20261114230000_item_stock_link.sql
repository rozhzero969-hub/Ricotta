-- An ordering item can be linked to one stock item in Ricotta Restaurant (its exact name there), so the
-- Order screen shows how much of it is in Main Storage. Rozh links them herself, one by one, in Manage;
-- nothing is linked here. One stock item may be linked to several ordering items.
alter table public.app_items add column if not exists stock_item text
  check (stock_item is null or char_length(stock_item) between 1 and 200);
