-- Whether the PC worker may save receipts (it needs ALLOW_SUBMIT=1 and the exact receipt success message).
alter table public.stock_worker_control add column worker_receipts_live boolean;
