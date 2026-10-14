-- Alias-only updates preserve every other catalog field and refuse stale proposals.
create or replace function public.app_internal_set_aliases(p_entries jsonb,p_actor text,p_device text)
returns jsonb language plpgsql set search_path='' as $$
declare e jsonb; r public.app_items%rowtype; conflicts jsonb:='[]'::jsonb; changed integer:=0;
begin
 if p_actor is null or p_actor not in ('rozha','yunis') or p_entries is null or jsonb_typeof(p_entries)<>'array' then raise exception 'Invalid alias update'; end if;
 if jsonb_array_length(p_entries) not between 1 and 200 then raise exception 'Invalid alias update'; end if;
 if (select count(*) from jsonb_array_elements(p_entries))<>(select count(distinct x->>'itemId') from jsonb_array_elements(p_entries) x) then raise exception 'Duplicate item'; end if;
 for e in select value from jsonb_array_elements(p_entries) order by value->>'itemId' loop
  if nullif(e->>'itemId','') is null or jsonb_typeof(e->'before') is distinct from 'array' or jsonb_typeof(e->'aliases') is distinct from 'array' then raise exception 'Invalid aliases'; end if;
  if jsonb_array_length(e->'before')>12 or jsonb_array_length(e->'aliases')>12 then raise exception 'Invalid aliases'; end if;
  if exists(select 1 from jsonb_array_elements((e->'before')||(e->'aliases')) a where jsonb_typeof(a)<>'string' or length(btrim(a#>>'{}')) not between 1 and 120) then raise exception 'Invalid alias'; end if;
  perform pg_advisory_xact_lock(hashtextextended('items:'||(e->>'itemId'),0));
  select * into r from public.app_items where id=e->>'itemId' for update;
  if not found or (e ? 'name' and r.name<>e->>'name') or (to_jsonb(r.aliases)<>e->'before' and to_jsonb(r.aliases)<>e->'aliases') then conflicts:=conflicts||jsonb_build_array(e->>'itemId'); end if;
 end loop;
 if jsonb_array_length(conflicts)>0 then return jsonb_build_object('conflicts',conflicts,'changed',0); end if;
 for e in select value from jsonb_array_elements(p_entries) order by value->>'itemId' loop
  select * into r from public.app_items where id=e->>'itemId';
  if to_jsonb(r.aliases)<>e->'aliases' then
   perform public.app_internal_catalog_change('items',r.id,to_jsonb(r)||jsonb_build_object('aliases',e->'aliases'),p_actor,p_device);
   changed:=changed+1;
  end if;
 end loop;
 return jsonb_build_object('conflicts','[]'::jsonb,'changed',changed);
end $$;
revoke all on function public.app_internal_set_aliases(jsonb,text,text) from public,anon,authenticated;
grant execute on function public.app_internal_set_aliases(jsonb,text,text) to service_role;
