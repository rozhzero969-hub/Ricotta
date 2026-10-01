-- Whether the PC worker may save ingredients (it needs ALLOW_SUBMIT=1 and the exact success messages).
alter table public.stock_worker_control add column worker_items_live boolean;
