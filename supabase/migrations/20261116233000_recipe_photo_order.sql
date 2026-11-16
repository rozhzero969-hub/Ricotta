-- Recipe photos can be dragged into any order on the recipe page. The order is kept per photo;
-- older photos keep the order they were added in (created_at breaks ties).
alter table public.app_recipe_photos add column if not exists sort_order int not null default 0;
