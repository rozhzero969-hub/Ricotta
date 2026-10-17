# Ricotta Orders

Restaurant orders, suppliers, items, units, Records, device controls and Rico chat. The static web app supports English, Kurdish and Arabic. GitHub Pages serves the app; Supabase runs the database and the `api` and `send-push` Edge Functions.

## Data and sign-in

Two named accounts use server-verified PINs. Browser requests use revocable session tokens. Database tables and internal helpers are restricted to `service_role`; never put that key in the browser or commit it.

Order History and Records retain the current **Asia/Baghdad calendar month**. Older orders, their lines and Records are permanently deleted at Baghdad midnight by `ricotta-monthly-history`; the daily cleanup catches up after downtime. The API also filters reads by month. PINs, the catalog and reminder settings are kept.

Orders retry with stable IDs. Each pending order has its own local storage entry so tabs cannot overwrite one shared queue. Settings shows the pending count, Retry sync and Export copy. Export a previous month's unsynced order before clearing browser storage: it cannot be written into a later month's history. An order whose save the server refuses can be dropped with Clear order (Undo brings it back). A phone whose clock runs ahead still saves: the server uses its own time for an order dated in the future.

Scheduled jobs (pg_cron): `ricotta-reminder-tick` every minute (reminders, Rico's messages, weather), `ricotta-daily-cleanup` (expired sessions, old attempts, alerts, inbox, notes), `ricotta-monthly-history` (the monthly cut) and `ricotta-cron-history` (keeps a week of pg_cron run history).

## The kitchen

Unfinished orders sync between devices signed in to the same account. Quantities are saved locally before syncing. Edits to different items merge; two different edits to the same item require choosing which quantity to keep. Rozha and Yunis have separate drafts. Visible devices check about every eight seconds and on returning to the app. The WhatsApp send queue stays on the device where it was started.

- **Kitchen streak** (`kitchen.js`, `app_streak`): every Baghdad day with a sent order adds a day for the whole kitchen. Rico can bring a broken streak back within 7 days (`recover_streak`). Undoing the day's only order takes the day back.
- **Kitchen notes** (`app_notes`): Rozha writes, Yunis gets a notification, a sticky note on Order and a banner; unread notes get a reminder from Rico after two hours.
- **Report card**: at the top of History, computed from this month's orders, with an Excel (CSV) file and a printable report before the monthly cleanup.
- **Weather**: the reminder tick keeps Erbil's weather from Open-Meteo in `app_weather` for Rico's morning messages.
- Pinned items (`app_accounts.pins`), item notes (`app_items.note`, sent in the WhatsApp message) and Undo for 15 minutes after an order is saved.
- Rozha and Yunis can read and delete each other's Rico chats; each only continues their own.
- **Order cut-offs** (`app_suppliers.cutoff`, HH:MM Erbil): on the supplier's order days (its reminder days, or every day) Order, Send and Suppliers show a countdown; Rico warns 30 minutes before when nothing has gone to that supplier.
- **Repeat orders** (`app_repeat_orders`): "Repeat" on a History order saves it for chosen weekdays; on those days the Order screen offers it with one tap. Nothing is sent by itself.
- **Note replies**: Yunis answers a note (quick replies or a few words); Rozha gets a notification and a count on the bell.
- **App icon badge**: unread notes, unseen replies and late suppliers (Home Screen app; on iPhone with notifications on).
- **Month archive** (`app_month_summaries`): before a month is cleared, `app_internal_monthly_cleanup` keeps its summary (orders, days, top items, suppliers, who sent). History › Past months.
- **Friday summary**: Rico's short weekly recap on Friday evening.
- On phones the WhatsApp buttons open the WhatsApp app directly (`whatsapp://send`); computers use `wa.me`.

The Lab (`lab/`, see its README) runs the real app on sample data for trying these without touching the kitchen.

## Simple workspace

The three main tabs are Order, Rico and Manage. Manage groups Items, Suppliers and Units, History, Records, Devices (Rozha only) and Settings keep separate tabs: in More on phones and directly in the desktop sidebar. Order keeps its large summary; Order options holds notes, quantity scaling, repeat orders, voice and clearing. Imports are in Manage > More tools. English aliases remain searchable and editable without adding lines to item lists. The app uses one palette with light, dark or system appearance. Quantity taps and the order-sent chime have switches in Settings > Order sounds. Themes, weather effects, seasonal surprises and Face ID have been removed; PIN sign-in stays protected by Cloudflare.

## Development and checks

Use Node 24, pnpm 10 and Deno 2. Serve the repository with a static HTTP server; do not open `index.html` as a file.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run lint
pnpm test
pnpm run test:ui
deno check --node-modules-dir=none --lock=deno.lock --frozen-lockfile supabase/functions/api/index.ts supabase/functions/send-push/index.ts
```

`EDGE_PATH` points the UI tests at an already installed Chromium or Edge instead of Playwright's own download.

Tests use mocked network requests and disposable PGlite/PostgreSQL databases. They do not access restaurant data or the internet. Database tests apply the baseline and every migration, then cover monthly cutoffs, cascading order-line deletion, audit rollback, session revocation, chat ownership, idempotent saves, the kitchen streak, the 15-minute undo and restricted helper permissions.

## Database bootstrap and deployment

`supabase/baseline.sql` is a verified schema-only snapshot of the retained tables/functions. On an **empty Supabase project**, enable `pgcrypto` and `pg_cron`, apply the baseline, then the SQL in `supabase/migrations/` in filename order. Configure the two account rows with privately generated bcrypt PIN hashes, recovery hashes and push/AI secrets. Do not use sample credentials in production.

The earlier migration chain mixed removed features with missing live migrations. It has been replaced in the repository by this baseline. Existing production migration history remains intact. Do not replay the baseline on production or repair its applied history merely to match filenames. Future migrations extend this baseline.

On the existing project, apply only the migrations that are not yet in its history (the first one, `simplify_orders_monthly_retention`, dropped the retired feature objects and reset sessions and devices once). Deploy both Edge Functions with JWT verification disabled because they verify their own PIN sessions or cron secret. `send-push` requires `x-cron-secret`; the existing minute tick remains configured. Update `APP_VERSION` whenever deploying browser changes.

## Optional Cloudflare sign-in protection

Turnstile can protect PIN sign-in on the existing GitHub Pages hostname, without buying a domain or moving hosting. It remains disabled until configured. Create a free **Managed** widget for `rozhzero969-hub.github.io`, then set these Supabase Edge Function secrets privately: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and `TURNSTILE_HOSTNAME=rozhzero969-hub.github.io`. Never commit the secret key. Configure both keys together and redeploy the API; partial configuration blocks sign-in safely.

The app requests Cloudflare's script only when enabled. The API verifies each token with Cloudflare and checks its hostname and `ricotta_auth` action before checking credentials. Tokens expire and cannot be reused. `GET /auth/security` exposes only whether protection is required and its public site key. Existing signed-in sessions keep working. This adds bot protection to sign-in; it does not put a Cloudflare firewall in front of Supabase. Test PIN and cancelled checks on the live hostname after activation. Remove both key secrets and redeploy to disable it if recovery is needed.

## Backups and recovery

Keep encrypted database backups outside the repository and browser. Supabase's backup availability depends on the project's plan; check the dashboard and use an external backup if necessary. Review the retention policy before restoring: normal cleanup immediately removes data from previous months. Restore business backups to a separate project first, verify catalog and current-month order counts, then redeploy functions and revoke restored sessions before switching traffic. `pnpm test` verifies that the schema baseline restores into an empty database; it is not a production-data recovery drill.

## Ordering tools

Supplier cards include WhatsApp and phone links. Orders support a shared whole-order note and quantities with up to three decimal places. Adjust quantities doubles or halves the selected items with confirmation and Undo. Settings → WhatsApp message lets each account customize the restaurant name, greeting and closing.

Items can be marked unavailable without deletion and given alternate search names. Items → Import Excel previews a first-sheet `.xlsx` or `.csv` file before saving, with at most 500 rows and a 2 MB file limit. Required column headings are `Name`, `Unit`, and `Supplier`; unit and supplier values must match one existing entry by name or ID. Optional headings are `ID`, `Aliases`, `Available`, and `Note`. Existing items match by ID or a unique name and supplier; omitted optional fields are preserved. Ambiguous or invalid rows must be corrected before importing.

The spreadsheet reader is the official SheetJS Community Edition 0.20.3 standalone build, stored locally in `vendor/` with its Apache 2.0 license. It loads only when importing a spreadsheet or making a stock file, and does not execute spreadsheet formulas.

## Excel for the workplace stock system

History → **Excel** on any sent order makes the file for the workplace stock system's *Upload Excel* button (Move stock between storages): one sheet named `Transfer` with the columns `Item name`, `Amount` and `Unit`, one row per item, the same item twice combined into one row. Units are written by their Kurdish name (کیلۆ, کارتۆن, دانە…). On a phone the file opens the share sheet (Save to Files, WhatsApp…); on a computer it downloads.

Each item can say how the stock system writes it (Manage → item → *Stock system (Excel)*): its name there, its unit there, and how many of those units are in one order unit (1 box = 20 kg → 20, so 3 boxes are written as 60 kg). Empty fields use the item's own name, unit and amount. The stock system matches names itself and marks anything it does not know, so nothing moves by guess.

## Smart search and Rico aliases

Order, Items, Suppliers, Units, History, Records and long dropdowns use the shared matcher in `supabase/functions/_shared/search.js`. It matches Kurdish/Arabic letter variants, English aliases, plural forms, unordered words and bounded spelling mistakes. Exact matches rank first; numeric values and short food names are not fuzzy matched. English aliases appear beneath the primary Kurdish item name, which remains the name sent to suppliers. Searches have clear buttons and result feedback. Record search searches beyond the first visible page without rebuilding the input.

Rico reads aliases, availability and item notes and can propose changes to these fields. `propose_item_aliases` previews up to 200 alias changes together. Confirmation calls an authenticated, atomic alias-only RPC that preserves all other catalog fields, writes audit events and refuses stale aliases or renamed/deleted items. Repeated confirmation is idempotent. Rico suggestions preserve fractional quantities and skip unavailable items.

The sign-in security check centres the Cloudflare widget and continues automatically after successful verification. PIN validation still happens on the server.
