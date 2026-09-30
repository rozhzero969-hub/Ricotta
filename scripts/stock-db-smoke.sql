-- Database smoke test for the stock migration. Run after creating minimal
-- stand-ins for app_items/app_units (see the CI step). Everything rolls back.
begin;
do $$
declare rid uuid; rid_box uuid; rid2 uuid; rid3 uuid; claimed uuid; v numeric; rejected boolean; k uuid:=gen_random_uuid();
begin
  insert into app_units(id,en) values ('box','box'),('pc','piece'),('kg','kg');
  insert into app_items(id,name,unit_id) values ('i1','Flour','box'),('i2','No buying unit',null);
  insert into stock_workers(id,token_hash) values ('office-pc','smoke') on conflict do nothing;

  -- Setup rules
  rejected:=false; begin perform stock_save_settings('i1','rozha','pc',null,null); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Different counting unit accepted without a conversion'; end if;
  rejected:=false; begin perform stock_save_settings('i2','rozha','pc',1,null); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Item without a buying format was set up'; end if;
  perform stock_save_settings('i1','rozha','pc',12,2);
  if not exists(select 1 from stock_item_settings where item_id='i1' and per_buying=12 and low_stock=2) then raise exception 'Settings not saved'; end if;
  perform stock_save_settings('i1','yunis','box',99,2);
  if exists(select 1 from stock_item_settings where item_id='i1' and per_buying is not null) then raise exception 'Same unit kept a conversion'; end if;
  perform stock_save_settings('i1','yunis','pc',12,2);

  -- Nothing can be transferred or counted before setup, or with no stock
  rejected:=false; begin perform stock_submit(gen_random_uuid(),'Main Storage','Pizza',false,'rozha','i2',1,'No buying unit','x'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Unset item was transferable'; end if;
  rejected:=false; begin perform stock_submit(gen_random_uuid(),'Main Storage','Pizza',false,'rozha','i1',1,'Flour','piece'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Transfer without stock accepted'; end if;

  -- Recount is the only way stock is entered
  perform stock_recount('i1','Main Storage',10,now(),'rozha','initial');
  select quantity into v from stock_balances where item_id='i1' and storage_name='Main Storage'; if v<>10 then raise exception 'Recount failed'; end if;
  rejected:=false; begin perform stock_recount('i1','Main Storage',1,now()+interval '1 day','rozha',null); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Future recount accepted'; end if;
  rejected:=false; begin perform stock_save_settings('i1','rozha','kg',5,null); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Counting unit changed while stock exists'; end if;

  -- Approval: idempotent, exact name/unit, reservation
  rid:=stock_submit(k,'Main Storage','Pizza',false,'rozha','i1',3,'Flour','piece');
  if rid<>stock_submit(k,'Main Storage','Pizza',false,'rozha','i1',3,'Flour','piece') then raise exception 'Not idempotent'; end if;
  rejected:=false; begin perform stock_submit(gen_random_uuid(),'Main Storage','Pizza',false,'rozha','i1',1,'Wrong','piece'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Stale name accepted'; end if;
  rejected:=false; begin perform stock_submit(gen_random_uuid(),'Main Storage','Pizza',false,'rozha','i1',8,'Flour','piece'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Reserved stock over-committed'; end if;
  rejected:=false; begin perform stock_recount('i1','Pizza',1,now(),'rozha',null); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Recount allowed during a pending transfer'; end if;

  -- Entering the amount in the buying format (1 box = 12 piece)
  rejected:=false; begin perform stock_submit(gen_random_uuid(),'Main Storage','Pizza',false,'rozha','i1',1,'Flour','kg','kg'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'A unit that is neither buying nor counting was accepted'; end if;
  rejected:=false; begin perform stock_submit(gen_random_uuid(),'Main Storage','Pizza',false,'rozha','i1',2,'Flour','box','box'); exception when others then rejected:=true; end;
  if not rejected then raise exception '2 boxes (24 piece) accepted with only 7 piece free'; end if;
  rid_box:=stock_submit(gen_random_uuid(),'Main Storage','Pizza',false,'rozha','i1',0.5,'Flour','box','box');
  if not exists(select 1 from stock_requests where id=rid_box and quantity=6 and unit_label='piece' and entered_quantity=0.5 and entered_unit_label='box') then
    raise exception 'Buying-unit request was not converted to counting units'; end if;
  if stock_reserved('i1','Main Storage')<>9 then raise exception 'Reservation is not in counting units'; end if;
  rejected:=false; begin perform stock_submit(gen_random_uuid(),'Main Storage','Pizza',false,'rozha','i1',0.5,'Flour','piece','box'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Label for the wrong unit accepted'; end if;
  perform stock_cancel(rid_box,'rozha');

  -- Gating: check -> screenshot -> final approve -> claim
  if stock_claim('office-pc') is not null then raise exception 'Unapproved request claimed'; end if;
  rejected:=false; begin perform stock_final_approve(rid,'rozha'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Final approval without a check'; end if;
  perform stock_preview_report(rid,'office-pc',true,'ok',null);
  rejected:=false; begin perform stock_final_approve(rid,'rozha'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Final approval without a screenshot'; end if;
  perform stock_preview_report(rid,'office-pc',true,'ok','data:image/jpeg;base64,AAAA');
  perform stock_final_approve(rid,'yunis');
  claimed:=stock_claim('office-pc'); if claimed<>rid then raise exception 'Approved request not claimed'; end if;
  rejected:=false; begin perform stock_cancel(rid,'rozha'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Running request cancelled'; end if;
  perform stock_finish(rid,'office-pc','completed','Moved!','data:image/jpeg;base64,BBBB');
  select quantity into v from stock_balances where item_id='i1' and storage_name='Main Storage'; if v<>7 then raise exception 'Source not reduced'; end if;
  select quantity into v from stock_balances where item_id='i1' and storage_name='Pizza'; if v<>3 then raise exception 'Destination not increased'; end if;
  if not exists(select 1 from stock_requests where id=rid and status='completed' and recorded_date=(now() at time zone 'Asia/Baghdad')::date) then raise exception 'Recorded date wrong'; end if;
  if (select count(*) from stock_shots where request_id=rid)<>2 then raise exception 'Screenshots missing'; end if;

  -- Cancel and change, yesterday date, reconcile
  rid2:=stock_submit(gen_random_uuid(),'Main Storage','Kebab',true,'yunis','i1',1,'Flour','piece');
  perform stock_cancel(rid2,'rozha');
  if not exists(select 1 from stock_requests where id=rid2 and status='failed') then raise exception 'Cancel failed'; end if;
  rid3:=stock_submit(gen_random_uuid(),'Main Storage','Kebab',true,'yunis','i1',1,'Flour','piece');
  perform stock_preview_report(rid3,'office-pc',true,'ok','data:image/jpeg;base64,CCCC'); perform stock_final_approve(rid3,'rozha');
  perform stock_claim('office-pc'); perform stock_finish(rid3,'office-pc','needs_checking','unclear',null);
  perform stock_resolve(rid3,'rozha','failed','Checked history: nothing moved',null);
  if not exists(select 1 from stock_requests where id=rid3 and status='failed') then raise exception 'Resolve failed'; end if;

  -- Two names: the app name is shown to people, the workplace name is what the PC searches for
  perform stock_save_settings('i1','yunis','pc',12,2,'Workplace Flour');
  rejected:=false; begin perform stock_submit(gen_random_uuid(),'Main Storage','Kebab',false,'rozha','i1',1,'Flour','piece'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'App name accepted where the workplace name is required'; end if;
  rid3:=stock_submit(gen_random_uuid(),'Main Storage','Kebab',false,'rozha','i1',1,'Workplace Flour','piece');
  if not exists(select 1 from stock_requests where id=rid3 and item_name='Workplace Flour' and app_name='Flour') then raise exception 'Names not stored'; end if;
  perform stock_cancel(rid3,'rozha');

  -- Zones: add, rename (carries through to stock), remove only when empty, always keep two
  perform stock_storage_add('Test Zone','rozha');
  rejected:=false; begin perform stock_storage_add('test zone','rozha'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Duplicate zone accepted'; end if;
  perform stock_recount('i1','Test Zone',4,now(),'rozha',null);
  perform stock_storage_rename('Test Zone','Renamed Zone','yunis');
  select quantity into v from stock_balances where item_id='i1' and storage_name='Renamed Zone'; if v is distinct from 4 then raise exception 'Rename lost the stock'; end if;
  if not exists(select 1 from stock_counts where storage_name='Renamed Zone') then raise exception 'Rename lost the count history'; end if;
  rejected:=false; begin perform stock_storage_delete('Renamed Zone','rozha'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Zone with stock removed'; end if;
  perform stock_recount('i1','Renamed Zone',0,now(),'rozha',null);
  perform stock_storage_delete('Renamed Zone','rozha');
  if not exists(select 1 from stock_storages where name='Renamed Zone' and archived) then raise exception 'Zone not hidden'; end if;
  perform stock_storage_add('Renamed Zone','rozha');
  if exists(select 1 from stock_storages where name='Renamed Zone' and archived) then raise exception 'Zone not restored'; end if;

  -- Screenshots older than 3 days are removed
  update stock_shots set taken_at=now()-interval '4 days' where request_id=rid;
  perform stock_cleanup();
  if exists(select 1 from stock_shots where request_id=rid) then raise exception 'Old screenshots kept'; end if;
end $$;
rollback;
