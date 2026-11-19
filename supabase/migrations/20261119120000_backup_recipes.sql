-- 2026-11-19: Ahmad's recipe book goes into the daily server copy (Admin > Restore).
--
-- Until now the daily copy (20261102120000_wipe_day_and_big_update.sql) held only the suppliers, units,
-- items and orders. It now also holds:
--   recipe_categories, recipe_ingredients, recipes, recipe_photos   the rows of the recipe tables
--   minibar                                                         the items Rozh picked for Ahmad's
--                                                                   Stock tab (app_accounts.settings
--                                                                   .minibarItems on Ahmad's account)
-- Left out on purpose: app_recipe_alert_state (only remembers which recipe alerts were already sent).
--
-- Restore keeps the same rule as before: it brings back what was deleted since that day and never
-- changes anything that exists now.
--   * categories, ingredients and recipes that are gone come back as they were in the copy;
--   * a recipe whose category is gone (and was not brought back, for example because a category with the
--     same name exists now) comes back without a category, never pointing at a missing row;
--   * photo rows come back only with a recipe brought back by this restore (like order lines with their
--     order), and only when the photo file is still in the recipe-photos bucket. Deleting a recipe also
--     deletes its files (api recipes.ts), so normally the recipe comes back without photos: the files
--     are only in the nightly Mac copy (scripts/backup-local.sh);
--   * the minibar picks that are gone are added back to Ahmad's list (only for items that exist), and the
--     picks there now are kept as they are.
-- Copies made before this migration have no recipe keys: restoring one brings back no recipes.
--
-- Recipes are listed column by column (not select *) so the planned drop of app_recipes.archived
-- (supabase/pending) does not need this function changed again.

create or replace function public.app_internal_make_backup(p_now timestamptz default now())
returns void language plpgsql set search_path = '' as $$
declare today date := (p_now at time zone 'Asia/Baghdad')::date;
begin
 insert into public.app_backups(day, data) values (today, jsonb_build_object(
   'suppliers', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.app_suppliers t),
   'units', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.app_units t),
   'items', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.app_items t),
   'orders', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.app_orders t),
   'lines', (select coalesce(jsonb_agg(to_jsonb(t) - 'id'), '[]') from public.app_order_lines t),
   'recipe_categories', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.app_recipe_categories t),
   'recipe_ingredients', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.app_recipe_ingredients t),
   'recipes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.app_recipes t),
   'recipe_photos', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.app_recipe_photos t),
   'minibar', (select coalesce(case when jsonb_typeof(a.settings->'minibarItems') = 'array' then a.settings->'minibarItems' end, '[]')
               from public.app_accounts a where a.id = 'ahmad')
 )) on conflict (day) do update set data = excluded.data, created_at = now();
 delete from public.app_backups where day < today - 7;
end $$;
revoke all on function public.app_internal_make_backup(timestamptz) from public, anon, authenticated;
grant execute on function public.app_internal_make_backup(timestamptz) to service_role;

/* What each kept copy holds, without sending the copies themselves. Copies from before 2026-11-19 have
   no recipes (0). */
create or replace function public.app_internal_list_backups()
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', day, 'suppliers', jsonb_array_length(data->'suppliers'), 'items', jsonb_array_length(data->'items'), 'orders', jsonb_array_length(data->'orders'),
    'recipes', coalesce(jsonb_array_length(data->'recipes'), 0), 'at', created_at) order by day desc), '[]')
  from public.app_backups;
$$;
revoke all on function public.app_internal_list_backups() from public, anon, authenticated;
grant execute on function public.app_internal_list_backups() to service_role;

/* Brings back what was deleted since that day. Nothing that exists now is changed. */
create or replace function public.app_internal_restore_backup(p_day date, p_actor text, p_device text)
returns jsonb language plpgsql set search_path = '' as $$
declare b jsonb; n_sup int; n_unit int; n_item int; n_order int;
  n_cat int; n_ing int; n_rec int; n_photo int := 0; n_mini int := 0;
  added_recipes uuid[]; cur jsonb; back jsonb;
begin
 if p_actor <> 'rozha' then raise exception 'Forbidden'; end if;
 select data into b from public.app_backups where day = p_day;
 if b is null then return jsonb_build_object('error', 'not_found'); end if;
 insert into public.app_suppliers select * from jsonb_populate_recordset(null::public.app_suppliers, b->'suppliers') on conflict do nothing;
 get diagnostics n_sup = row_count;
 insert into public.app_units select * from jsonb_populate_recordset(null::public.app_units, b->'units') on conflict do nothing;
 get diagnostics n_unit = row_count;
 insert into public.app_items select * from jsonb_populate_recordset(null::public.app_items, b->'items') on conflict do nothing;
 get diagnostics n_item = row_count;
 with added as (
   insert into public.app_orders select * from jsonb_populate_recordset(null::public.app_orders, b->'orders') on conflict do nothing returning id
 ), lines as (
   insert into public.app_order_lines(order_id, supplier_id, item_id, item_name, unit_id, qty, supplier_name, prev_last_ordered_at)
   select l.order_id, s.id, i.id, l.item_name, u.id, l.qty, l.supplier_name, l.prev_last_ordered_at
   from jsonb_populate_recordset(null::public.app_order_lines, b->'lines') l
   join added a on a.id = l.order_id
   left join public.app_suppliers s on s.id = l.supplier_id
   left join public.app_items i on i.id = l.item_id
   left join public.app_units u on u.id = l.unit_id
   returning 1
 ) select count(*) into n_order from added;

 -- Recipe book. "on conflict do nothing" also skips a category whose name is taken now (one spelling each).
 insert into public.app_recipe_categories(id, name, color, sort, created_by, created_at, updated_at)
 select c.id, c.name, c.color, c.sort, ac.id, c.created_at, c.updated_at
 from jsonb_populate_recordset(null::public.app_recipe_categories, coalesce(b->'recipe_categories', '[]')) c
 left join public.app_accounts ac on ac.id = c.created_by
 on conflict do nothing;
 get diagnostics n_cat = row_count;
 insert into public.app_recipe_ingredients select * from jsonb_populate_recordset(null::public.app_recipe_ingredients, coalesce(b->'recipe_ingredients', '[]')) on conflict do nothing;
 get diagnostics n_ing = row_count;
 with added as (
   insert into public.app_recipes(id, name, data, version, updated_by, updated_at, category_id)
   select r.id, r.name, r.data, r.version, coalesce(ac.id, p_actor), r.updated_at, cat.id
   from jsonb_populate_recordset(null::public.app_recipes, coalesce(b->'recipes', '[]')) r
   left join public.app_accounts ac on ac.id = r.updated_by
   left join public.app_recipe_categories cat on cat.id = r.category_id
   on conflict do nothing returning id
 ) select coalesce(array_agg(id), '{}') into added_recipes from added;
 n_rec := cardinality(added_recipes);
 if n_rec > 0 then
   if to_regclass('storage.objects') is not null then
     insert into public.app_recipe_photos(id, recipe_id, path, caption, created_at, sort_order)
     select p.id, p.recipe_id, p.path, coalesce(p.caption, ''), coalesce(p.created_at, now()), coalesce(p.sort_order, 0)
     from jsonb_populate_recordset(null::public.app_recipe_photos, coalesce(b->'recipe_photos', '[]')) p
     where p.recipe_id = any(added_recipes)
       and exists (select 1 from storage.objects o where o.bucket_id = 'recipe-photos' and o.name = p.path)
     order by p.recipe_id, p.sort_order
     on conflict do nothing;
   else
     -- No storage here (the PGlite tests): the rows alone.
     insert into public.app_recipe_photos(id, recipe_id, path, caption, created_at, sort_order)
     select p.id, p.recipe_id, p.path, coalesce(p.caption, ''), coalesce(p.created_at, now()), coalesce(p.sort_order, 0)
     from jsonb_populate_recordset(null::public.app_recipe_photos, coalesce(b->'recipe_photos', '[]')) p
     where p.recipe_id = any(added_recipes)
     order by p.recipe_id, p.sort_order
     on conflict do nothing;
   end if;
   get diagnostics n_photo = row_count;
 end if;

 -- Ahmad's minibar picks: the ones gone come back (items that exist only), the ones there stay.
 select case when jsonb_typeof(a.settings->'minibarItems') = 'array' then a.settings->'minibarItems' else '[]'::jsonb end
   into cur from public.app_accounts a where a.id = 'ahmad' for update;
 if found and jsonb_typeof(b->'minibar') = 'array' then
   select coalesce(jsonb_agg(x.id order by x.n), '[]') into back
   from (select e.value as id, min(e.n) as n from jsonb_array_elements_text(b->'minibar') with ordinality e(value, n) group by e.value) x
   where not cur ? x.id and exists (select 1 from public.app_items i where i.id = x.id);
   back := (select coalesce(jsonb_agg(v order by n), '[]') from jsonb_array_elements(back) with ordinality t(v, n) where n <= greatest(300 - jsonb_array_length(cur), 0));
   n_mini := jsonb_array_length(back);
   if n_mini > 0 then
     update public.app_accounts set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{minibarItems}', cur || back) where id = 'ahmad';
   end if;
 end if;

 insert into public.app_audit_events(id, actor, device_id, action, entity_type, entity_name, payload)
 values (gen_random_uuid()::text, p_actor, p_device, 'restore', 'backup', p_day::text, jsonb_build_object('suppliers', n_sup, 'units', n_unit, 'items', n_item, 'orders', n_order,
   'recipes', n_rec, 'recipe_ingredients', n_ing, 'recipe_categories', n_cat, 'recipe_photos', n_photo, 'minibar', n_mini));
 return jsonb_build_object('suppliers', n_sup, 'units', n_unit, 'items', n_item, 'orders', n_order,
   'recipes', n_rec, 'recipe_ingredients', n_ing, 'recipe_categories', n_cat, 'recipe_photos', n_photo, 'minibar', n_mini);
end $$;
revoke all on function public.app_internal_restore_backup(date, text, text) from public, anon, authenticated;
grant execute on function public.app_internal_restore_backup(date, text, text) to service_role;
