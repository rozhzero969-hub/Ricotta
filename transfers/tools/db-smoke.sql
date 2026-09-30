-- Database-only smoke test. Everything is rolled back; no POS transfer occurs.
begin;
do $$
declare iid uuid; rid uuid; rid2 uuid; rid3 uuid; duplicate_id uuid; claimed uuid; new_item uuid; item_name text; request_key uuid:=gen_random_uuid();
  v numeric; rejected boolean;
begin
  item_name:='Smoke Flour';
  select public.transfer_save_item(null,'rozha',jsonb_build_object('exact_name',item_name,
    'counting_unit','bag','usage_unit','kg','match_verified',true,'units',jsonb_build_array(
      jsonb_build_object('unit','kg','count_per_unit',null,'verified',false)))) into iid;
  insert into public.transfer_balances(item_id,storage_name,quantity) values(iid,'Main Storage',3);
  select public.transfer_submit(request_key,'Main Storage','Pizza',false,'rozha',
    jsonb_build_array(jsonb_build_object('item_id',iid,'unit','bag','quantity',1,'expected_name',item_name,'expected_factor',1))) into rid;
  select public.transfer_submit(request_key,'Main Storage','Pizza',false,'rozha',
    jsonb_build_array(jsonb_build_object('item_id',iid,'unit','bag','quantity',1,'expected_name',item_name,'expected_factor',1))) into duplicate_id;
  if rid<>duplicate_id then raise exception 'Idempotency failed'; end if;
  select quantity into v from public.transfer_balances where item_id=iid and storage_name='Main Storage';
  if v<>3 then raise exception 'Approval changed stock'; end if;
  rejected:=false;
  begin
    perform public.transfer_save_item(iid,'rozha',jsonb_build_object('exact_name','Changed during approval',
      'counting_unit','bag','match_verified',true,'units','[]'::jsonb));
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Pending item edit was accepted'; end if;
  rejected:=false;
  begin
    perform public.transfer_submit(gen_random_uuid(),'Main Storage','Pizza',false,'yunis',
      jsonb_build_array(jsonb_build_object('item_id',iid,'unit','bag','quantity',1,'expected_name','Wrong name','expected_factor',1)));
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Stale catalog name was accepted'; end if;
  rejected:=false;
  begin
    perform public.transfer_submit(gen_random_uuid(),'Main Storage','Pizza',false,'yunis',
      jsonb_build_array(jsonb_build_object('item_id',iid,'unit','kg','quantity',1)));
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Unverified unit was accepted'; end if;
  rejected:=false;
  begin
    perform public.transfer_submit(gen_random_uuid(),'Main Storage','Pizza',false,'yunis',
      jsonb_build_array(jsonb_build_object('item_id',iid,'unit','bag','quantity',99,'expected_name',item_name,'expected_factor',1)));
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Insufficient stock was accepted'; end if;
  select public.transfer_claim('office-pc') into claimed;
  if claimed<>rid then raise exception 'Wrong queue request claimed'; end if;
  perform public.transfer_finish(rid,'office-pc','completed','Mocked confirmation, rolled back');
  select quantity into v from public.transfer_balances where item_id=iid and storage_name='Main Storage';
  if v<>2 then raise exception 'Source ledger update failed'; end if;
  select quantity into v from public.transfer_balances where item_id=iid and storage_name='Pizza';
  if v<>1 then raise exception 'Destination ledger update failed'; end if;
  perform public.transfer_recount(iid,'Pizza','bag',2,now(),'yunis','Mock count, rolled back');
  select quantity into v from public.transfer_balances where item_id=iid and storage_name='Pizza';
  if v<>2 then raise exception 'Recount update failed'; end if;
  select public.transfer_save_item(null,'yunis',jsonb_build_object('exact_name','Mock item',
    'counting_unit','box','match_verified',false,'units',jsonb_build_array(
      jsonb_build_object('unit','piece','count_per_unit',0.1,'verified',true)))) into new_item;
  if not exists(select 1 from public.transfer_units where item_id=new_item and unit='piece' and verified) then
    raise exception 'Catalog unit save failed'; end if;
  perform public.transfer_set_archive(new_item,'yunis',true);
  if not exists(select 1 from public.transfer_items where id=new_item and archived_at is not null) then
    raise exception 'Archive failed'; end if;
  select public.transfer_submit(gen_random_uuid(),'Main Storage','Pizza',true,'yunis',
    jsonb_build_array(jsonb_build_object('item_id',iid,'unit','bag','quantity',0.5,'expected_name',item_name,'expected_factor',1))) into rid2;
  select public.transfer_claim('office-pc') into claimed;
  if claimed<>rid2 then raise exception 'Yesterday request not claimed'; end if;
  perform public.transfer_finish(rid2,'office-pc','completed','Mocked yesterday confirmation, rolled back');
  if not exists(select 1 from public.transfer_requests where id=rid2 and
    recorded_date=(now() at time zone 'Asia/Baghdad')::date-1) then
    raise exception 'Yesterday recorded date was wrong'; end if;
  select public.transfer_submit(gen_random_uuid(),'Main Storage','Pizza',false,'rozha',
    jsonb_build_array(jsonb_build_object('item_id',iid,'unit','bag','quantity',0.25,'expected_name',item_name,'expected_factor',1))) into rid3;
  select public.transfer_claim('office-pc') into claimed;
  perform public.transfer_finish(rid3,'office-pc','needs_checking','Mocked ambiguous result, rolled back');
  perform public.transfer_resolve(rid3,'rozha','failed','Checked workplace history: no transfer',null);
  if not exists(select 1 from public.transfer_requests where id=rid3 and status='failed' and recorded_date is null) then
    raise exception 'Manual failed reconciliation was wrong'; end if;
end $$;
rollback;
