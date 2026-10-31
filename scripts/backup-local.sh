#!/bin/sh
# Nightly copy of the kitchen's data on this Mac, in ~/Ricotta Backups (the newest 30 files stay).
# One query, so everything in a file is from the same moment. Left out on purpose: secrets, PIN hashes,
# sign-in sessions, push keys, and short-lived counters.
# Runs from ~/Library/LaunchAgents/com.ricotta.backup.plist, only while the Mac is on.
set -eu
DIR="$HOME/Ricotta Backups"
SUPABASE="$HOME/.local/bin/supabase"
PROJECT=pxufdcyqjtmtklmrjodg
mkdir -p "$DIR"
cd "$DIR"
export PATH="$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
FILE="ricotta-$(date +%Y-%m-%d).json"
TMP="$FILE.part"
SQL="$(mktemp)"
trap 'rm -f "$SQL" "$TMP"' EXIT
{
  printf "select jsonb_build_object('at', now()"
  for t in suppliers items units orders order_lines month_summaries order_drafts reminder_settings streak stock_items rico_orders rico_chats audit_events usage_time; do
    printf ", '%s', (select coalesce(jsonb_agg(t), '[]') from public.app_%s t)" "$t" "$t"
  done
  printf ", 'accounts', (select coalesce(jsonb_agg(t), '[]') from (select id, name, roles, pins from public.app_accounts) t)) as backup;\n"
} > "$SQL"
"$SUPABASE" db query --linked --project-ref "$PROJECT" --output json -f "$SQL" > "$TMP" || { echo "$(date '+%Y-%m-%d %H:%M') backup failed: the query did not finish"; exit 1; }
# A failed or empty answer never replaces a good file.
grep -q '"order_lines"' "$TMP" || { echo "$(date '+%Y-%m-%d %H:%M') backup failed: unexpected answer"; exit 1; }
mv "$TMP" "$FILE"
ls -1t ricotta-*.json | tail -n +31 | while IFS= read -r old; do rm -f "$old"; done
echo "$(date '+%Y-%m-%d %H:%M') saved $FILE"
