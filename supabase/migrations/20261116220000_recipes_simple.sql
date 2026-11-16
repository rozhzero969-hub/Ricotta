-- 2026-11-16: simpler Recipes for Ahmad.
--
-- 1. Ingredients get a category (picked from the ones in use, or a new one), so the Items and
--    ingredients tab can group them like the recipes are grouped.
-- 2. The recipe book starts again from empty: every recipe, ingredient, photo and recipe alert written
--    while testing is deleted (Rozh's decision). Nothing else is touched: no stock, orders, invoices or
--    settings.
alter table public.app_recipe_ingredients add column if not exists category text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'app_recipe_ingredients_category_len' and conrelid = 'public.app_recipe_ingredients'::regclass) then
    alter table public.app_recipe_ingredients add constraint app_recipe_ingredients_category_len check (length(category) <= 60);
  end if;
end $$;

-- The test data. Photo rows go with their recipe (on delete cascade), but are deleted first anyway.
delete from public.app_recipe_photos;
delete from public.app_recipes;
delete from public.app_recipe_ingredients;
delete from public.app_recipe_alert_state;
-- The recipe alerts already sent to Ahmad's Recipes page are about the deleted test recipes.
delete from public.app_rico_inbox where kind = 'recipe';

-- The photo files themselves are in the private storage bucket recipe-photos (see
-- 20261116111626_ahmad_recipes.sql). Supabase may refuse a direct delete on storage.objects (it asks for
-- the Storage API instead): then this step says so and does nothing, and the files can be emptied from
-- the bucket in the dashboard (Storage, recipe-photos, select all, Delete). Nothing links to them any more.
do $$ begin
  if to_regclass('storage.objects') is not null then
    begin
      perform set_config('storage.allow_delete_query', 'true', true);
      delete from storage.objects where bucket_id = 'recipe-photos';
    exception when others then
      raise notice 'recipe-photos files were not deleted here (%). Empty the bucket in the dashboard.', sqlerrm;
    end;
  end if;
end $$;
