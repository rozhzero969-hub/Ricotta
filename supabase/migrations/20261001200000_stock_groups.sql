-- Item groups: named lists of items ("Veggies", "Desserts") shown as filters on the Stock screen.
-- People make them in the app, or Rico proposes one and the person confirms it.
create table public.stock_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 40),
  item_ids text[] not null default '{}',
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);
create unique index stock_groups_name_key on public.stock_groups (lower(trim(name)));
alter table public.stock_groups enable row level security;
revoke all on public.stock_groups from public, anon, authenticated;

-- Create (p_id null) or replace a group's name and items. Unknown item ids are dropped; duplicates removed.
create function public.stock_group_save(p_id uuid, p_name text, p_items text[], p_actor text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare g_id uuid; clean text[]; nm text := trim(coalesce(p_name,''));
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  if length(nm) = 0 or length(nm) > 40 then raise exception 'Enter a group name (up to 40 letters)'; end if;
  if coalesce(array_length(p_items,1),0) > 1000 then raise exception 'Too many items'; end if;
  select coalesce(array_agg(x.id order by x.ord), '{}') into clean from (
    select distinct on (i.id) i.id, u.ord from unnest(coalesce(p_items,'{}')) with ordinality u(v, ord)
    join public.app_items i on i.id = u.v order by i.id, u.ord) x;
  if exists(select 1 from public.stock_groups where lower(trim(name)) = lower(nm) and id is distinct from p_id) then
    raise exception 'A group with this name already exists'; end if;
  if p_id is null then
    if (select count(*) from public.stock_groups) >= 40 then raise exception 'Too many groups'; end if;
    insert into public.stock_groups(name,item_ids,created_by,updated_by) values(nm,clean,p_actor,p_actor) returning id into g_id;
  else
    update public.stock_groups set name = nm, item_ids = clean, updated_by = p_actor, updated_at = now() where id = p_id returning id into g_id;
    if g_id is null then raise exception 'Group not found'; end if;
  end if;
  insert into public.stock_events(actor,action,details) values(p_actor, case when p_id is null then 'group_created' else 'group_edited' end,
    jsonb_build_object('group_id',g_id,'name',nm,'items',coalesce(array_length(clean,1),0)));
  return g_id;
end $$;

create function public.stock_group_delete(p_id uuid, p_actor text)
returns void language plpgsql security invoker set search_path=public as $$
declare nm text;
begin
  perform pg_advisory_xact_lock(729291);
  if p_actor not in ('rozha','yunis') then raise exception 'Invalid actor'; end if;
  delete from public.stock_groups where id = p_id returning name into nm;
  if nm is null then raise exception 'Group not found'; end if;
  insert into public.stock_events(actor,action,details) values(p_actor,'group_deleted',jsonb_build_object('group_id',p_id,'name',nm));
end $$;

revoke all on function public.stock_group_save(uuid,text,text[],text) from public,anon,authenticated;
grant execute on function public.stock_group_save(uuid,text,text[],text) to service_role;
revoke all on function public.stock_group_delete(uuid,text) from public,anon,authenticated;
grant execute on function public.stock_group_delete(uuid,text) to service_role;
grant select, insert, update, delete on public.stock_groups to service_role;
