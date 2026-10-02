-- Regression checks for all-or-nothing writes, retry safety and quotas.
begin;
do $$
declare lines jsonb; rejected boolean; rid bigint; jid uuid; before_events bigint; login_ids bigint[];
begin
  insert into public.app_units(id,en) values('atomic-box','box'),('atomic-piece','piece');
  insert into public.app_items(id,name,unit_id) values('atomic-item','Flour','atomic-box');
  insert into public.app_suppliers(id,name) values('atomic-supplier','Bakery');
  insert into public.app_item_pars(item_id,par_qty,est_qty) values('atomic-item',20,5);
  lines := '[{"supplier_id":"atomic-supplier","supplier_name":"Bakery","item_id":"atomic-item","item_name":"Flour","unit_id":"atomic-box","qty":3}]';
  if not public.app_internal_save_order('atomic-order',now(),'rozha',lines) then raise exception 'Initial order was not saved'; end if;
  if public.app_internal_save_order('atomic-order',now(),'rozha',lines) then raise exception 'Retry saved again'; end if;
  if (select count(*) from public.app_order_lines where order_id='atomic-order') <> 1 or
     (select est_qty from public.app_item_pars where item_id='atomic-item') <> 8 then raise exception 'Retry duplicated lines or stock'; end if;
  rejected := false;
  begin
    perform public.app_internal_save_order('atomic-invalid',now(),'rozha',lines || lines);
  exception when unique_violation then rejected := true; end;
  if not rejected or exists(select 1 from public.app_orders where id='atomic-invalid') or
     (select est_qty from public.app_item_pars where item_id='atomic-item') <> 8 then raise exception 'Failed order left partial writes'; end if;
  rejected := false;
  begin perform public.app_internal_save_order('atomic-empty',now(),'rozha','[]'); exception when others then rejected := true; end;
  if not rejected or exists(select 1 from public.app_orders where id='atomic-empty') then raise exception 'Empty order accepted'; end if;
  if not public.app_internal_decay_stock('atomic-item',2,current_date) or
     public.app_internal_decay_stock('atomic-item',2,current_date) or
     public.app_internal_decay_stock('atomic-item',2,current_date-1) then raise exception 'Daily decay is not idempotent'; end if;
  if (select est_qty from public.app_item_pars where item_id='atomic-item') <> 6 then raise exception 'Daily decay quantity is wrong'; end if;
  perform public.stock_save_item_settings('atomic-item','rozha','atomic-piece',12,2,'Flour','atomic-piece',null,true);
  select count(*) into before_events from public.stock_events;
  rejected := false;
  begin perform public.stock_save_item_settings('atomic-item','rozha','atomic-box',null,9,'Changed','missing-unit',1,true);
  exception when others then rejected := true; end;
  if not rejected or not exists(select 1 from public.stock_item_settings where item_id='atomic-item' and counting_unit='atomic-piece' and low_stock=2 and workplace_name='Flour') or
     (select count(*) from public.stock_events) <> before_events then raise exception 'Invalid usage partially saved settings or events'; end if;
  perform public.stock_save_item_settings('atomic-item','rozha','atomic-piece',12,3,'Flour',null,null,false);
  if not exists(select 1 from public.stock_item_settings where item_id='atomic-item' and usage_unit='atomic-piece' and low_stock=3) then raise exception 'Omitted usage was cleared'; end if;
  rid := public.app_internal_reserve_assistant('atomic-device','rozha','pending:chat',1,2);
  if rid is null or public.app_internal_reserve_assistant('atomic-device','rozha','pending:chat',1,2) is not null then raise exception 'Device quota failed'; end if;
  if public.app_internal_reserve_assistant('other-device','yunis','pending:chat',1,2) is null or
     public.app_internal_reserve_assistant('third-device','rozha','pending:chat',1,2) is not null then raise exception 'Global quota failed'; end if;
  login_ids := public.app_internal_reserve_login(array['atomic-ip','atomic-global'],600,1,2);
  if coalesce(array_length(login_ids,1),0) <> 2 or public.app_internal_reserve_login(array['atomic-ip','atomic-global'],600,1,2) is not null then raise exception 'Login IP quota failed'; end if;
  update public.app_login_attempts set succeeded=true where id=any(login_ids);
  if public.app_internal_reserve_login(array['atomic-ip','atomic-global'],600,1,2) is null or
     public.app_internal_reserve_login(array['other-ip','atomic-global'],600,1,2) is null or
     public.app_internal_reserve_login(array['third-ip','atomic-global'],600,1,2) is not null then raise exception 'Login global quota failed'; end if;
  insert into public.stock_item_jobs(client_key,item_id,item_name,kind,payload,created_by)
    values(gen_random_uuid(),'atomic-item','Flour','create','{}','rozha') returning id into jid;
  rejected := false;
  begin insert into public.stock_item_jobs(client_key,item_id,item_name,kind,payload,created_by)
    values(gen_random_uuid(),'atomic-item','Flour','edit','{}','yunis'); exception when unique_violation then rejected := true; end;
  if not rejected then raise exception 'Two pending ingredient jobs accepted'; end if;
  update public.stock_item_jobs set status='cancelled' where id=jid;
  insert into public.stock_item_jobs(client_key,item_id,item_name,kind,payload,created_by)
    values(gen_random_uuid(),'atomic-item','Flour','edit','{}','yunis');
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
      ('app_internal_save_order','app_internal_decay_stock','app_internal_reserve_assistant','app_internal_reserve_login','stock_save_item_settings') and
      (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then raise exception 'Browser role can call internal helper'; end if;
end $$;
rollback;
