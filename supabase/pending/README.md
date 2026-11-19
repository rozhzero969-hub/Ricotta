Migrations written but not applied yet. They stay out of supabase/migrations so the PGlite tests and `supabase db push` do not run them; each file says when it may be moved into supabase/migrations (keep its name and version).

- 20261120000000_drop_recipes_archived.sql: stage 3 of retiring app_recipes.archived; move it once the api from 2026-11-19 is live and no signed-in phone runs an app older than 2026-11-16.5.
