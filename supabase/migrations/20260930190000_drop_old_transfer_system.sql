-- The first, separate transfer system (transfer_* tables and functions) is replaced by the stock_* tables.
drop table if exists public.transfer_lines, public.transfer_events, public.transfer_counts, public.transfer_balances, public.transfer_requests,
  public.transfer_items, public.transfer_units, public.transfer_storages, public.transfer_workers cascade;
drop function if exists public.transfer_cancel(uuid,text), public.transfer_claim(text), public.transfer_final_approve(uuid,text),
  public.transfer_finish(uuid,text,text,text,jsonb), public.transfer_preview_report(uuid,text,boolean,text),
  public.transfer_resolve(uuid,text,text,text,date), public.transfer_save_item(uuid,text,jsonb), public.transfer_seed(jsonb),
  public.transfer_set_archive(uuid,text,boolean), public.transfer_set_recorded_date(),
  public.transfer_recount(uuid,text,text,numeric,timestamptz,text), public.transfer_submit(uuid,text,text,boolean,text,jsonb);
