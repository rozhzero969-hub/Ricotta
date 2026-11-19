#!/bin/sh
# Nightly copy of the kitchen's data on this Mac, in ~/Ricotta Backups (the newest 30 files stay).
# One query, so everything in a file is from the same moment. Left out on purpose: secrets, PIN hashes,
# sign-in sessions, push keys, and short-lived counters.
# Ahmad's recipe book is in it too (recipes, ingredients, categories, photo rows, and his minibar picks
# from his account's settings). The recipe photo files are copied next to it, in
# ~/Ricotta Backups/recipe-photos/<recipe id>/<photo id>.jpg: each file once (a photo never changes), and
# kept after the recipe is deleted, so a deleted recipe's photos can still be found here.
# Runs from ~/Library/LaunchAgents/com.ricotta.backup.plist at login and every hour, one file a day, only while the Mac is on.
set -eu
DIR="$HOME/Ricotta Backups"
SUPABASE="$HOME/.local/bin/supabase"
PROJECT=pxufdcyqjtmtklmrjodg
mkdir -p "$DIR"
cd "$DIR"
export PATH="$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
FILE="ricotta-$(date +%Y-%m-%d).json"
# Checked every hour while the Mac is on, so a night it was asleep or off is caught up the same day.
[ -s "$FILE" ] && exit 0
TMP="$FILE.part"
SQL="$(mktemp)"
trap 'rm -f "$SQL" "$TMP"' EXIT
{
  printf "select jsonb_build_object('at', now()"
  for t in suppliers items units orders order_lines month_summaries order_drafts streak rico_orders rico_chats audit_events usage_time recipes recipe_ingredients recipe_categories recipe_photos; do
    printf ", '%s', (select coalesce(jsonb_agg(t), '[]') from public.app_%s t)" "$t" "$t"
  done
  printf ", 'accounts', (select coalesce(jsonb_agg(t), '[]') from (select id, name, roles, pins from public.app_accounts) t), 'minibar_items', (select coalesce(settings->'minibarItems', '[]') from public.app_accounts where id = 'ahmad')) as backup;\n"
} > "$SQL"
"$SUPABASE" db query --linked --project-ref "$PROJECT" --output json -f "$SQL" > "$TMP" || { echo "$(date '+%Y-%m-%d %H:%M') backup failed: the query did not finish"; exit 1; }
# A failed or empty answer never replaces a good file.
grep -q '"order_lines"' "$TMP" || { echo "$(date '+%Y-%m-%d %H:%M') backup failed: unexpected answer"; exit 1; }
mv "$TMP" "$FILE"
# The recipe photo files. Never fails the backup above: a photo that can't be copied now is tried again
# with the next file. Only paths shaped like the app makes them (<uuid>/<uuid>.jpg) are used.
PHOTOS="$DIR/recipe-photos"
U='[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}'
jq -r '.[0].backup.recipe_photos[]?.path // empty' "$FILE" 2>/dev/null | grep -x "$U/$U\.jpg" | while IFS= read -r p; do
  [ -s "$PHOTOS/$p" ] && continue
  mkdir -p "$PHOTOS/${p%/*}"
  if "$SUPABASE" storage cp "ss:///recipe-photos/$p" "$PHOTOS/$p.part" --experimental --linked --project-ref "$PROJECT" >/dev/null 2>&1 && [ -s "$PHOTOS/$p.part" ]; then
    mv "$PHOTOS/$p.part" "$PHOTOS/$p"
  else
    rm -f "$PHOTOS/$p.part"; echo "$(date '+%Y-%m-%d %H:%M') photo not copied: $p"
  fi
done
ls -1t ricotta-*.json | tail -n +31 | while IFS= read -r old; do rm -f "$old"; done
echo "$(date '+%Y-%m-%d %H:%M') saved $FILE"
