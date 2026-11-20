Migrations written but not applied yet. They stay out of supabase/migrations so the PGlite tests and `supabase db push` do not run them; each file says when it may be moved into supabase/migrations (keep its name and version).

None waiting. (20261120000000_drop_recipes_archived was applied on 2026-11-20 and moved into supabase/migrations.)
