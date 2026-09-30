-- Zones (storages) can be added, renamed and removed from the app. A zone's name is also how the PC finds
-- it in the workplace system, so a rename carries through to every stock row, count and request.
-- Removing a zone hides it (history keeps pointing at it); adding the same name again brings it back.
alter table public.stock_storages add column archived boolean not null default false;

alter table public.stock_balances drop constraint stock_balances_storage_name_fkey,
  add constraint stock_balances_storage_name_fkey foreign key (storage_name) references public.stock_storages(name) on update cascade;
alter table public.stock_counts drop constraint stock_counts_storage_name_fkey,
  add constraint stock_counts_storage_name_fkey foreign key (storage_name) references public.stock_storages(name) on update cascade;
alter table public.stock_requests drop constraint stock_requests_from_storage_fkey,
  add constraint stock_requests_from_storage_fkey foreign key (from_storage) references public.stock_storages(name) on update cascade;
alter table public.stock_requests drop constraint stock_requests_to_storage_fkey,
  add constraint stock_requests_to_storage_fkey foreign key (to_storage) references public.stock_storages(name) on update cascade;

create function public.stock_storage_add(p_name text, p_actor text)
returns void language plpgsql security invoker set search_path=public as $$
declare nm text := trim(coalesce(p_name,''));
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  if length(nm) < 1 or length(nm) > 60 then raise exception 'Zone names need 1 to 60 characters'; end if;
  if exists(select 1 from public.stock_storages where lower(name) = lower(nm) and not archived) then
    raise exception 'That zone already exists'; end if;
  if exists(select 1 from public.stock_storages where lower(name) = lower(nm) and archived) then
    update public.stock_storages set archived = false, sort_order = (select coalesce(max(sort_order),0) + 1 from public.stock_storages)
      where lower(name) = lower(nm);
  else
    insert into public.stock_storages(name, sort_order) select nm, coalesce(max(sort_order),0) + 1 from public.stock_storages;
  end if;
  insert into public.stock_events(actor,action,details) values(p_actor,'zone_added',jsonb_build_object('name',nm));
end $$;

create function public.stock_storage_rename(p_old text, p_new text, p_actor text)
returns void language plpgsql security invoker set search_path=public as $$
declare nm text := trim(coalesce(p_new,''));
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  if length(nm) < 1 or length(nm) > 60 then raise exception 'Zone names need 1 to 60 characters'; end if;
  if not exists(select 1 from public.stock_storages where name = p_old and not archived) then raise exception 'Zone not found'; end if;
  if nm = p_old then return; end if;
  if exists(select 1 from public.stock_storages where lower(name) = lower(nm) and name <> p_old) then
    raise exception 'A zone with that name already exists'; end if;
  if exists(select 1 from public.stock_requests where status in ('waiting','running','needs_checking') and (from_storage = p_old or to_storage = p_old)) then
    raise exception 'Finish or cancel this zone''s pending transfers first'; end if;
  update public.stock_storages set name = nm where name = p_old;   -- cascades to balances, counts and requests
  insert into public.stock_events(actor,action,details) values(p_actor,'zone_renamed',jsonb_build_object('from',p_old,'to',nm));
end $$;

create function public.stock_storage_delete(p_name text, p_actor text)
returns void language plpgsql security invoker set search_path=public as $$
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  if not exists(select 1 from public.stock_storages where name = p_name and not archived) then raise exception 'Zone not found'; end if;
  if (select count(*) from public.stock_storages where not archived) <= 2 then raise exception 'Keep at least two zones'; end if;
  if exists(select 1 from public.stock_requests where status in ('waiting','running','needs_checking') and (from_storage = p_name or to_storage = p_name)) then
    raise exception 'Finish or cancel this zone''s pending transfers first'; end if;
  if exists(select 1 from public.stock_balances where storage_name = p_name and quantity > 0) then
    raise exception 'This zone still has stock. Move it out or recount it to 0 first'; end if;
  delete from public.stock_balances where storage_name = p_name;
  update public.stock_storages set archived = true where name = p_name;
  insert into public.stock_events(actor,action,details) values(p_actor,'zone_removed',jsonb_build_object('name',p_name));
end $$;

do $$ declare f text; begin
  foreach f in array array['stock_storage_add(text,text)','stock_storage_rename(text,text,text)','stock_storage_delete(text,text)'] loop
    execute format('revoke all on function public.%s from public,anon,authenticated',f);
    execute format('grant execute on function public.%s to service_role',f);
  end loop;
end $$;
