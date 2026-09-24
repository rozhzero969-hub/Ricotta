-- History keeps the supplier's name with every sent order line, so an order
-- still reads "Bakery House" after that supplier is renamed or deleted
-- (deleting a supplier sets order_lines.supplier_id to null).
alter table public.app_order_lines add column if not exists supplier_name text;

update public.app_order_lines l
set supplier_name = s.name
from public.app_suppliers s
where l.supplier_id = s.id and l.supplier_name is null;

-- The app loads the newest sent orders first.
create index if not exists app_orders_sent_at_idx on public.app_orders (sent_at desc) where status = 'sent';
