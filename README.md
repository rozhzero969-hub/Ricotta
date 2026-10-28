# Ricotta Orders

Restaurant orders, suppliers, items, units, Records, Rozha's Admin tab and Rico chat. The static web app supports English, Kurdish and Arabic. GitHub Pages serves the app; Supabase runs the database and the `api` and `send-push` Edge Functions.

## Data and sign-in

Two named accounts use server-verified PINs. Only Rozha changes a PIN, hers or Yunis's, in Admin › PINs: the server checks her current PIN first (wrong tries count like wrong sign-ins), refuses weak PINs and the other account's PIN, and signs that account out everywhere except the device making the change. There is no secret code. Browser requests use revocable session tokens. Database tables and internal helpers are restricted to `service_role`; never put that key in the browser or commit it.

**Yunis's roles** (`app_accounts.roles`): Rozha always has everything. For Yunis, `null` is the standard set (everything except Transfers); Admin › Access saves an explicit list once Rozha changes it. The roles are `history`, `manage`, `catalog`, `record`, `transfers`, `assistant`, `send`, `exports`, `notify` and `reminders`. The api checks them on every request (`can()` in `api/index.ts`) and answers 403 without the role; bootstrap sends the screens (`views`) and `roles`, and the app hides what he can't use. A change shows up on his phone at its next refresh, without signing in again.

Order History and Records retain the current **Asia/Baghdad calendar month**. Older orders, their lines and Records are permanently deleted at Baghdad midnight by `ricotta-monthly-history`; the daily cleanup catches up after downtime. The API also filters reads by month. PINs, the catalog and reminder settings are kept.

Orders retry with stable IDs. Each pending order has its own local storage entry so tabs cannot overwrite one shared queue. Settings shows the pending count, Retry sync and Export copy. Export a previous month's unsynced order before clearing browser storage: it cannot be written into a later month's history. An order whose save the server refuses can be dropped with Clear order (Undo brings it back). A phone whose clock runs ahead still saves: the server uses its own time for an order dated in the future.

Scheduled jobs (pg_cron): `ricotta-reminder-tick` every minute (reminders, Rico's messages, weather), `ricotta-daily-cleanup` (expired sessions, old attempts, alerts, inbox), `ricotta-monthly-history` (the monthly cut) and `ricotta-cron-history` (keeps a week of pg_cron run history).

## The kitchen

Unfinished orders sync between devices signed in to the same account. Quantities are saved locally before syncing. Edits to different items merge; two different edits to the same item require choosing which quantity to keep. Rozha and Yunis have separate drafts. Visible devices check about every eight seconds and on returning to the app. The WhatsApp send queue stays on the device where it was started.

- **Kitchen streak** (`kitchen.js`, `app_streak`): every Baghdad day with a sent order adds a day for the whole kitchen. Rico can bring a broken streak back within 7 days (`recover_streak`). Undoing the day's only order takes the day back.
- **Report card**: at the top of History, computed from this month's orders, with an Excel file and a PDF before the monthly cleanup.
- **Exports** (`exports.js`): Excel and PDF of items and suppliers with this month's order counts (`reports/catalog`), the month's report and a sent order as a PDF. Files carry the Ricotta header; Excel cells are written as text, never formulas. PDFs open in a sheet with a Done button, so a phone always has a way back.
- **Weather**: the reminder tick keeps Erbil's weather from Open-Meteo in `app_weather` for Rico's morning messages.
- Pinned items (`app_accounts.pins`), item notes (`app_items.note`, sent in the WhatsApp message) and, for Rozha, Undo for 15 minutes after an order is saved (older ones with her PIN).
- Rico's chat history is one list for both people, each chat marked with who started it; both can open and delete any chat (or all), and each only continues their own.
- **Order cut-offs** (`app_suppliers.cutoff`, HH:MM Erbil): on the supplier's order days (its reminder days, or every day) Order, Send and Suppliers show a countdown; Rico warns 30 minutes before when nothing has gone to that supplier.
- **App icon badge**: late suppliers (Home Screen app; on iPhone with notifications on).
- **Month archive** (`app_month_summaries`): before a month is cleared, `app_internal_monthly_cleanup` keeps its summary (orders, days, top items, suppliers, who sent). History › Past months.
- **Friday summary**: Rico's short weekly recap on Friday evening.
- On phones the WhatsApp buttons open the WhatsApp app directly (`whatsapp://send`); computers use `wa.me`.

The Lab (`lab/`, see its README) runs the real app on sample data for trying these without touching the kitchen.

- **Rico's orders (test)** (`send_test_order` in `assistant.ts`, `app_rico_orders`): when Rozha asks ("Rico, order from the bakery"), Rico builds each supplier's order (usual amounts from recent orders, plus any she names) and sends it at once over the WhatsApp Cloud API. While testing, every message goes only to her own number. The orders are kept apart from the kitchen's (not in History, the report or the streak) and listed under History › Rico's orders (`GET rico/orders`, Rozha only). The token, sending number and her number are Supabase Edge Function secrets (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEST_TO`) that the app never sees. Messages are plain text, so she messages the test number once a day (WhatsApp's 24-hour window). At most 20 an hour.

## Simple workspace

The tab bar holds the first four screens of Order, History, Transfers, Manage, Records and Admin that the person may open. With four or fewer there is no More (Yunis's standard set is Order, History, Manage and Records); with more, the rest are under More on phones and listed in the desktop sidebar. Rico is the green "Rico" button in the top bar and Settings is in the account sheet. On phones the pages swipe like the Home Screen (the next page follows the finger and carries on at its speed), the tab bar shrinks to icons while scrolling down, and a round button beside it goes back to the top. Items and Suppliers are interactive tables: tap a column to sort, filter with the chips, choose the columns, and tap a row for its details and actions. The search button in each heading (or ⌘K / Ctrl+K) searches items (with − and + in place), suppliers (with Call and WhatsApp), this month's orders (by item, supplier, person or day, such as "24/10"), units, Rico's chats, screens, actions and switches, best match first; it understands "tomato 5", has All, Items, Suppliers, Orders and Actions, remembers what was opened lately, and offers Ask Rico for anything it cannot answer. Press ? for the other keyboard shortcuts. Order keeps its large summary, then Rico suggests, Same as last time and Clear order (both with Undo), shown directly. Import Excel / CSV is next to Add item. Transfers is still being made: the tab shows its design, but it is inert and the server refuses its routes (`TRANSFERS_READY` in `transfers.js`, `TRANSFERS_OPEN` in the api) until the workplace system can take the file. English aliases remain searchable and editable without adding lines to item lists. The app uses one palette with light, dark or system appearance. Quantity taps and the order-sent chime have switches in Settings › Order sounds. Endless decorations (the Online dot, the only pulsing dot; the streak flame; the Transfers tape; Rico's face) run only on the screen that shows them, pause while the app is out of sight or the battery is low and not charging (where the browser tells), and stop with Reduce Motion. Themes, weather effects, seasonal surprises and Face ID have been removed; PIN sign-in stays protected by Cloudflare, which checks and continues by itself (Try Again appears only if it fails).

## Admin

Rozha's Admin is one screen of tiles; each opens its page. **Problems**: errors on any phone (crashes, failed promises, console errors, server errors) and Settings › Report a Problem arrive quietly through `POST problems` (`reports.js`; at most 10 per call and 20 a minute, sizes checked by the api and again by `app_problem_reports`), grouped by problem with the phones and app versions. **Security**: sign-ins, wrong PINs, locks (with Unlock), new phones (Rozha also gets a notification), PIN and role changes (`app_security_events`, 90 days). **Health Check**: the server, database space, the four jobs, notifications, problems and wrong PINs in plain words. **Access**: Yunis's roles. **PINs**, **Devices**, **Time in the app** (`app_usage_time`, per person and phone, daily, weekly or monthly with the average per day; never deleted, not even at sign-out), **Rico** (this month's use; Rico's AI: Claude Haiku 5.5 first, then the free Gemini and Groq, each with its last state, replies and tokens; no bill or cost is guessed; the AI keys are never typed into or shown by the app: they are set on the server only, as Supabase Edge Function secrets (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`) or in the locked `app_secrets` table; last states in `app_ai_status`) and **Catalog check-up** (items without a supplier or unit, unavailable, or not ordered in 30 days, from `app_items.last_ordered_at`).

Ricotta's map card (the satellite picture `ricotta-map.jpg`, Esri World Imagery, credited on the map) sits under the tiles; the sign-in and Welcome back show the same picture in Ricotta's green. It ships with the app, so it shows offline.

## Live changes

An open app keeps one request waiting on `GET signals` (`app_signals`, bumped by triggers on the tables): the server answers within about a second of a change (orders, items, suppliers, units, Yunis's access, drafts, sign-ins and sign-outs, remote Refresh or Log Out, the security log, problems, Rico's messages) or after 25 seconds, and the app loads only what changed. Only kinds and counters travel, never data. If it cannot connect, the app checks every 15 to 20 seconds instead; app updates are checked every 15 seconds.

The site is kept out of search engines with `noindex` on every page (a `robots.txt` would only count at the domain's root, which GitHub Pages gives to another repository). `404.html` is the branded page for addresses that don't exist.

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

`supabase/baseline.sql` is a verified schema-only snapshot of the retained tables/functions. On an **empty Supabase project**, enable `pgcrypto` and `pg_cron`, apply the baseline, then the SQL in `supabase/migrations/` in filename order. Configure the two account rows with privately generated bcrypt PIN hashes and push/AI secrets. Do not use sample credentials in production.

The earlier migration chain mixed removed features with missing live migrations. It has been replaced in the repository by this baseline. Existing production migration history remains intact. Do not replay the baseline on production or repair its applied history merely to match filenames. Future migrations extend this baseline.

On the existing project, apply only the migrations that are not yet in its history (the first one, `simplify_orders_monthly_retention`, dropped the retired feature objects and reset sessions and devices once). Deploy both Edge Functions with JWT verification disabled because they verify their own PIN sessions or cron secret. `send-push` requires `x-cron-secret`; the existing minute tick remains configured. Update `APP_VERSION` whenever deploying browser changes.

## Optional Cloudflare sign-in protection

Turnstile can protect PIN sign-in on the existing GitHub Pages hostname, without buying a domain or moving hosting. It remains disabled until configured. Create a free **Managed** widget for `rozhzero969-hub.github.io`, then set these Supabase Edge Function secrets privately: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and `TURNSTILE_HOSTNAME=rozhzero969-hub.github.io`. Never commit the secret key. Configure both keys together and redeploy the API; partial configuration blocks sign-in safely.

The app requests Cloudflare's script only when enabled. The API verifies each token with Cloudflare and checks its hostname and `ricotta_auth` action before checking credentials. Tokens expire and cannot be reused. `GET /auth/security` exposes only whether protection is required and its public site key. Existing signed-in sessions keep working. This adds bot protection to sign-in; it does not put a Cloudflare firewall in front of Supabase. Test PIN and cancelled checks on the live hostname after activation. Remove both key secrets and redeploy to disable it if recovery is needed.

## Backups and recovery

Keep encrypted database backups outside the repository and browser. Supabase's backup availability depends on the project's plan; check the dashboard and use an external backup if necessary. Review the retention policy before restoring: normal cleanup immediately removes data from previous months. Restore business backups to a separate project first, verify catalog and current-month order counts, then redeploy functions and revoke restored sessions before switching traffic. `pnpm test` verifies that the schema baseline restores into an empty database; it is not a production-data recovery drill.

## Ordering tools

Supplier cards include WhatsApp and phone links. Quantities have up to three decimal places. The WhatsApp message to a supplier is the same for everyone: a heading, then one line per item (with the item's note, if it has one).

Items can be marked unavailable without deletion and given alternate search names. Items → Import Excel previews a first-sheet `.xlsx` or `.csv` file before saving, with at most 500 rows and a 2 MB file limit. Required column headings are `Name`, `Unit`, and `Supplier`; unit and supplier values must match one existing entry by name or ID. Optional headings are `ID`, `Aliases`, `Available`, and `Note`. Existing items match by ID or a unique name and supplier; omitted optional fields are preserved. Ambiguous or invalid rows must be corrected before importing.

The spreadsheet reader is the official SheetJS Community Edition 0.20.3 standalone build, stored locally in `vendor/` with its Apache 2.0 license. It loads only when importing items from a spreadsheet or reading a stock list in Transfers, and does not execute spreadsheet formulas. Excel and PDF exports don't use it.

## Transfers

Transfers is its own tab (Rozha; Yunis only if she gives him the Transfers role in Admin › Access) and has nothing to do with ordering. It makes the Excel file for the workplace stock system's *Upload Excel* button on **Move between storages**; the From and To storages are still chosen there. Until that button exists the tab is locked: it shows "This tab is still being made" above an inert picture of the design, nobody can use or test it, and the api answers its four routes with 423. To open it, set `TRANSFERS_READY` in `transfers.js` and `TRANSFERS_OPEN` in `supabase/functions/api/index.ts` to `true`, and redeploy the api.

- **Workplace item list.** Upload any Excel or CSV with an item name column once (the stock system's own template works: its *Item list* and *Units* sheets are read). A unit column is optional; several units are separated by commas. A new upload replaces the list; items that stay keep their id and remembered spellings. Stored in `app_stock_items`, reachable only through the API.
- **Adding items.** Type or paste a list, say it (the microphone), take a photo of a paper list, or search an item. Rico reads the list and picks each item from the workplace list; the server accepts only ids from that list and units the item has. Without Rico the phone matches the names itself. A name is taken as sure only when it is exactly the item's name, one half of "English - کوردی" or "کوردی (English)", or a remembered spelling; anything else is marked for the person to confirm or pick, and *Remember* in the picker saves the spelling for next time.
- **Units.** Units can be written in English, Kurdish or Arabic (`kg`, `pcs`, `ml`, `tray`, `bucket`, `set`, `کیلۆ`, `كيلو`, ...) and become the item's own unit by themselves. When the item is counted in another size of that unit, the amount is worked out exactly (`3 kg` of an item counted in `غرام` becomes `3000 غرام`, `500 g` of one counted in `کیلۆ` becomes `0.5 کیلۆ`) and the row shows `3 kg = 3000 غرام`; an amount that would need rounding is never converted. A unit the item does not have, or no unit for an item with two, is left for the person to choose. Sizes in names are not amounts (`1L Kiwi 5`, `Milk Alfajer 24*380 3`, `Cooking Oil 18L 2`), number words count on lines without digits (`two`, `دوو`, `نیو`, `کیلۆیەک`, `كيلوين`), and a spoken line with several items is split into rows. Rico names unknown unit spellings from a fixed list (`kg`, `g`, `piece`, ...), checked on the server; it never converts amounts itself.
- **The file.** *Make Excel* stays off until every row has an item, an amount and one of that item's units. The file has the template's sheets (`Transfer`, `Item list`, `Units`, `How to fill`); `Transfer` keeps the first row exactly `Item name`, `Amount`, `Unit`, with a green heading row, banded rows, a frozen heading and dropdowns of the workplace items and units. On a phone it opens the share sheet; on a computer it downloads as `transfer-YYYY-MM-DD-HHMM.xlsx`.

## Smart search and Rico aliases

Order, Items, Suppliers, Units, History, Records and long dropdowns use the shared matcher in `supabase/functions/_shared/search.js`. It matches Kurdish/Arabic letter variants, English aliases, plural forms, unordered words and bounded spelling mistakes. Exact matches rank first; numeric values and short food names are not fuzzy matched. English aliases appear beneath the primary Kurdish item name, which remains the name sent to suppliers. Searches have clear buttons and result feedback. Record search searches beyond the first visible page without rebuilding the input.

Rico reads aliases, availability and item notes and can propose changes to these fields. `propose_item_aliases` previews up to 200 alias changes together. Confirmation calls an authenticated, atomic alias-only RPC that preserves all other catalog fields, writes audit events and refuses stale aliases or renamed/deleted items. Repeated confirmation is idempotent. Rico suggestions preserve fractional quantities and skip unavailable items.

The sign-in security check centres the Cloudflare widget and continues automatically after successful verification. PIN validation still happens on the server.

## Security checks and publishing

See [SECURITY.md](SECURITY.md) for the authentication model, permission boundaries, rate limits and hosting limitations. Build the browser-only publishing artifact with `node scripts/build-site.cjs`; configure GitHub Pages to use GitHub Actions. Do not publish the repository root. Publishing waits for the tests: `pages.yml` runs only after **Checks** passed on main, also requires **Security** to have passed for that commit, and builds that exact commit (never a newer, untested one). Main is protected: changes arrive through pull requests whose `smoke` and `audit` checks passed. Security CI audits the Node and Deno dependency locks and scans Git history without logging secret values.

## Loading and performance

`pnpm install --frozen-lockfile` then `node scripts/build-site.cjs` builds minified JavaScript/CSS with content-hashed filenames. Fonts are self-hosted WOFF2 (licenses in `fonts/`); `font-display: optional` avoids late swaps moving controls. Spreadsheet parsing/export and Cloudflare's widget load only when needed. The install icon uses a sized, lazy WebP; notification/PWA icons remain losslessly compressed PNGs.

The loading screen is inline in `index.html`, so it paints on the first frame: solid dark green, a green bar paints the word in, then the dot, "ORDERS" and a filling bar. On a fast start it stays only until the word is painted (about a second), never longer; with reduced motion it lifts at once.

On phones the sign-in page is one light column: the ricotta mark, "Welcome back.", six PIN boxes, the number pad (with a "Clear" key) and the language at the bottom. On computers it has two halves: the green "A calmer kitchen" side and a white side where the PIN is typed on the keyboard, with the language in the top corner. The number pad shows only on touch screens; everywhere else the page says the PIN is typed and signs in by itself after the sixth digit. The green side stays green in dark mode.

Every screen opens with today's date in a small green line, its name and one sentence on what it is for. Cards are white with a hairline edge and no shadow; items on the Order screen are soft grey tiles that turn white with a green edge once picked. On computers the sidebar runs the full height with the ricotta mark at the top and the current screen in a mint highlight. Buttons are round (pills and circles). Every switch (Record's filters, Manage's Items / Suppliers / Units, dark mode, Rico's history) and the phone tab bar can be held and slid: the highlight follows the finger and each part it passes opens as it goes (dark mode waits until you let go). The shared values (surfaces, corner sizes, the switch highlight) are tokens at the top of `style.css`. App text never uses em dashes.

If starting ever fails, the app shows "Ricotta could not open" with Refresh instead of an endless loading screen; if its scripts cannot load at all, a Reload link appears on the loading screen after 15 seconds (it needs no script).

The service worker caches only exact, immutable files from the current build. Opening the app always asks the server for the newest page (a quick "not modified" when nothing changed), so a page saved before an update can never point at files the update replaced; offline, the copy the browser kept is used. It never caches HTML, the live version marker, API replies, sessions or business data. New builds discard obsolete static caches and preserve notification badges. GitHub Pages still controls HTTP cache headers; its short TTL may remain a Lighthouse warning on cold visits.

For repeatable local phone measurements, run `node scripts/performance-browser.cjs dist /tmp/ricotta-performance`. This uses 179 sample items, a mocked API, Slow 4G and 4x CPU throttling; it does not measure production database speed. Run Lighthouse against the published URL for public sign-in metrics. `UI_SITE_DIR=dist` exercises the actual optimized artifact with the UI, order-queue and search smoke scripts.
