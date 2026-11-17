-- 2026-11-17: recipe categories from a prepared list.
--
-- Until now a recipe's category was a word Ahmad typed into the recipe (app_recipes.data.category), so
-- "Cakes", "cakes" and "Cake" could each become a group. Categories now live in their own table and a
-- recipe points to one of them. Nobody types a category in a form any more: Rozh and Ahmad add, rename
-- and delete categories by asking Rico (api recipe-categories.ts), and each category has one of ten
-- soft colours (supabase/functions/_shared/recipe-colors.js) shown behind its recipes' photos.
--
-- Like the other recipe tables it is reached through the API only (service role); the API checks the
-- person can open Recipes before every read and change.
create table if not exists public.app_recipe_categories(
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and length(name) between 1 and 60),
  -- The same ten names as PALETTE in _shared/recipe-colors.js.
  color text not null check (color in ('mint','butter','peach','sky','lilac','rose','sand','sage','apricot','mist')),
  sort integer not null default 0,
  created_by text references public.app_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One spelling per category: "cakes" and "Cakes" are the same.
create unique index if not exists app_recipe_categories_name_key on public.app_recipe_categories (lower(name));
alter table public.app_recipe_categories enable row level security;
revoke all on public.app_recipe_categories from public, anon, authenticated;
grant all on public.app_recipe_categories to service_role;

-- A recipe has one category or none. Deleting a category leaves its recipes without one.
alter table public.app_recipes add column if not exists category_id uuid references public.app_recipe_categories(id) on delete set null;
create index if not exists app_recipes_category_idx on public.app_recipes(category_id);

-- The categories in use today become rows (A to Z, each with the next colour of the ten), and every
-- recipe is pointed at its row. The typed word is then taken out of the recipe's data. Running this
-- again changes nothing: a recipe without a typed category is left alone.
do $$
declare
  palette text[] := array['mint','butter','peach','sky','lilac','rose','sand','sage','apricot','mist'];
  taken integer;
begin
  select count(*) into taken from public.app_recipe_categories;
  insert into public.app_recipe_categories(name, color, sort, created_by)
  select x.name, palette[((taken + x.n - 1) % 10) + 1], taken + x.n, x.by
  from (
    select min(btrim(r.data->>'category')) as name, min(r.updated_by) as by,
           row_number() over (order by lower(btrim(r.data->>'category'))) as n
    from public.app_recipes r
    where btrim(coalesce(r.data->>'category', '')) <> '' and length(btrim(r.data->>'category')) <= 60
    group by lower(btrim(r.data->>'category'))
  ) x
  where not exists (select 1 from public.app_recipe_categories c where lower(c.name) = lower(x.name));

  update public.app_recipes r set category_id = c.id
  from public.app_recipe_categories c
  where r.category_id is null and lower(btrim(coalesce(r.data->>'category', ''))) = lower(c.name);

  update public.app_recipes set data = data - 'category' where data ? 'category';
end $$;
