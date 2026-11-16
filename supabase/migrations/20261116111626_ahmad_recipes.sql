-- Third named account; no usable PIN until Rozh sets it in Admin.
-- Extend only explicit two-person account checks. No permissions become public.
do $$ declare c record; d text; begin
 for c in select conrelid::regclass as tbl,conname,pg_get_constraintdef(oid) as def from pg_constraint where contype='c' and connamespace='public'::regnamespace loop
  if c.def like '%''rozha''%' and c.def like '%''yunis''%' then
   d:=replace(c.def,'''yunis''::text','''yunis''::text, ''ahmad''::text');
   if d<>c.def then execute format('alter table %s drop constraint %I',c.tbl,c.conname); execute format('alter table %s add constraint %I %s',c.tbl,c.conname,d); end if;
  end if;
 end loop;
 -- Existing internal helpers validate the same named accounts. Preserve their locks and privileges.
 for c in select oid,pg_get_functiondef(oid) as def from pg_proc where pronamespace='public'::regnamespace and proname like 'app_%' and prokind='f' loop
  d:=regexp_replace(c.def,'''rozha'',\s*''yunis''','''rozha'',''yunis'',''ahmad''','g');
  d:=replace(d,'p_account is distinct from ''yunis''','p_account not in (''yunis'',''ahmad'')');
  if d<>c.def then execute d; end if;
 end loop;
end $$;
alter table public.app_accounts drop constraint if exists app_accounts_roles_known;
alter table public.app_accounts add constraint app_accounts_roles_known check (roles is null or (cardinality(roles)<=12 and roles <@ array['order','recipes','history','manage','catalog','record','assistant','send','exports','notify','receipts','transfers']::text[]));
insert into public.app_accounts(id,name,pin_hash,roles) values('ahmad','Ahmad',extensions.crypt(extensions.gen_random_uuid()::text,extensions.gen_salt('bf',12)),'{}') on conflict(id) do nothing;
create table public.app_recipe_ingredients(
 id uuid primary key, name text not null check(length(name) between 1 and 120),
 stock_item text not null check(length(stock_item) between 1 and 200),
 unit text not null check(length(unit) between 1 and 80),
 version integer not null default 1, updated_at timestamptz not null default now()
);
create table public.app_recipes(
 id uuid primary key, name text not null check(length(name) between 1 and 120),
 data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=180000),
 version integer not null default 1, archived boolean not null default false,
 updated_by text not null references public.app_accounts(id), updated_at timestamptz not null default now()
);
create table public.app_recipe_photos(
 id uuid primary key, recipe_id uuid not null references public.app_recipes(id) on delete cascade,
 path text not null unique, caption text not null default '' check(length(caption)<=200), created_at timestamptz not null default now()
);
alter table public.app_recipe_ingredients enable row level security;
alter table public.app_recipes enable row level security;
alter table public.app_recipe_photos enable row level security;
revoke all on public.app_recipe_ingredients,public.app_recipes,public.app_recipe_photos from public,anon,authenticated;
grant all on public.app_recipe_ingredients,public.app_recipes,public.app_recipe_photos to service_role;
create index app_recipes_recent_idx on public.app_recipes(updated_at desc);
create index app_recipe_photos_recipe_idx on public.app_recipe_photos(recipe_id);
-- Private storage setup is conditional below so schema-only PGlite restores also work.
-- Serialize the photo cap even when two phones upload together.
create function public.app_recipe_photo_limit() returns trigger language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.recipe_id::text,17));
 if (select count(*) from public.app_recipe_photos where recipe_id=new.recipe_id)>=8 then raise exception 'Photo limit reached'; end if;
 return new;
end $$;
revoke all on function public.app_recipe_photo_limit() from public,anon,authenticated;
create trigger app_recipe_photo_limit before insert on public.app_recipe_photos for each row execute function public.app_recipe_photo_limit();
-- A recipe's saved unit must not be silently reinterpreted by editing the ingredient.
create function public.app_recipe_ingredient_unit_lock() returns trigger language plpgsql set search_path='' as $$
begin
 if old.unit<>new.unit and exists(select 1 from public.app_recipes r,jsonb_array_elements(r.data->'lines') l where l->>'ingredient'=old.id::text) then raise exception 'Unit is used by a recipe; create a separate ingredient'; end if;
 return new;
end $$;
revoke all on function public.app_recipe_ingredient_unit_lock() from public,anon,authenticated;
create trigger app_recipe_ingredient_unit_lock before update on public.app_recipe_ingredients for each row execute function public.app_recipe_ingredient_unit_lock();

-- Only the authenticated API accesses recipe images. No public storage policies.
do $$ begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('recipe-photos','recipe-photos',false,3000000,array['image/jpeg']) on conflict(id) do nothing;
 end if;
end $$;
