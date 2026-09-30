# Ricotta Stock Transfers

Phone site: `https://rozhzero969-hub.github.io/Ricotta/transfers/` after this branch is published to GitHub Pages.

The phone site uses the existing Ricotta Orders PIN accounts, Rozha and Yunis. It keeps a separate stock ledger and sends **approved** transfers to a PC worker. The worker interacts only with the workplace **Move between storages** page. A request stays in the app queue until the PC is running and all checks pass.

## Current safety state

- The worker is configured with `ALLOW_SUBMIT=0`. It can inspect and fill the form but cannot click **Move it**.
- Live submission needs the exact workplace success message in `CONFIRMED_SUCCESS_TEXT`, followed by one deliberately approved pilot transfer. Do not guess a message.
- The September 29 PDF seeded 342 separate item rows into Supabase. Sixteen names are literally `-`, exactly as in the report. They remain separate records; an ambiguous workplace match cannot transfer.
- Initial balances are a snapshot from that PDF. Outside purchases, orders, and counts can make the workplace balances differ. The worker compares visible workplace stock with the app ledger and stops on a mismatch. Record the same recount in both systems before retrying.
- The PDF's usage totals are stored for reference. Only the counting unit is initially verified at a factor of 1. Add and verify other conversion factors item by item. A unit without a verified factor cannot transfer or be used for recounts.

## Office PC setup

1. Install Node.js 20 or newer and pnpm from their official sources if needed.
2. In `transfers/worker`, run `pnpm install --frozen-lockfile`.
3. The local `transfers/worker/.env` already contains this PC's private queue token. Keep it on this PC only. It is ignored by Git. On another PC, provision a new token and its hash with `transfers/tools/provision_worker.py`; do not copy the token into the public repository.
4. Run `start-worker.cmd` or `node worker.mjs`. It opens a dedicated Edge profile. Sign in to the workplace website in that Edge window once, then leave the transfer page available.
5. The default queue check is every five seconds. The worker sets browser zoom to 100%, verifies storages, item names, units, entered amounts, visible stock, and the yesterday setting before submission. It handles one request at a time.

To enable live submission **after** the success message is confirmed, set `CONFIRMED_SUCCESS_TEXT` to its exact visible text and `ALLOW_SUBMIT=1` in the ignored `.env` file. Restart the worker. The app will then require an explicit phone approval for each request. A completed request updates both sides of the app ledger; a pre-submit failure changes neither. An unclear result becomes **Needs checking**, holds its source stock reservation, and is never retried automatically.

For **Needs checking**, inspect that exact transfer in the workplace system. In the phone History screen, record whether it actually succeeded. If it did, enter the workplace recorded date. The app ledger changes only after that confirmation. If it did not happen, mark it failed; the reservation is released.

## Phone workflow

1. Choose different source and destination storages.
2. Search for each exact item; choose a verified unit and amount. Up to 20 lines use one workplace transfer form.
3. Leave **Record for yesterday** off unless needed. When on, the workplace records the transfer for the day before the PC submits it. The app history shows the confirmed recorded date; queue approval may happen on an earlier day.
4. Review every line. **Approve and queue** is the only action that releases a request to the PC. Edits require review again. A changed item name or conversion between review and approval is rejected by the database.

## Data and deployment

The public `transfers/` files contain code and the Supabase project URL only. They contain no PINs, worker token, PDF catalog, or stock quantities. Private transfer tables have RLS enabled and no browser grants; the Edge Function checks the existing PIN session or the PC worker token. The raw worker token exists only in ignored `transfers/worker/.env`. The PDF extraction and import SQL stay under ignored `tmp/`.

The code uses the existing GitHub Pages repository and Supabase free project. Hosting can pause or hit free limits; when the queue API is unavailable, the worker stops. Nothing upgrades automatically.

## Safe checks

- `node transfers/tools/ui-smoke.mjs` uses a mocked API in a mobile Edge viewport. It does not call live Supabase or the workplace site.
- `node transfers/tools/smoke_worker.mjs` checks queue authentication read-only.
- `transfers/tools/db-smoke.sql` tests database approval, duplicate prevention, unit checks, stock movement, recount, yesterday date, and reconciliation inside a rolled-back transaction. It never touches the workplace site.

The worker's browser controls were checked against the live form without clicking **Move it**. No real transfer has been submitted by this project.
