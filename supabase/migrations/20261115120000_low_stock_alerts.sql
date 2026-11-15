-- Low stock alerts (Manage, an item's stock settings): Rozh can set a level for an ordering item that is
-- linked to a Ricotta Restaurant stock item. The level is counted in that stock item's counting format
-- (4 is 4 cartons for an item counted in cartons, 4 kilos for one counted in kilos). When Main Storage
-- holds that much or less, the item shows yellow on the Order screen and Rozh and Yunis get one alert;
-- low_alerted_at keeps that alert from repeating until the stock is back above the level.
-- null low_alert: no alert for this item.
alter table public.app_items add column if not exists low_alert numeric
  check (low_alert is null or (low_alert >= 0 and low_alert <= 999999));
alter table public.app_items add column if not exists low_alerted_at timestamptz;
