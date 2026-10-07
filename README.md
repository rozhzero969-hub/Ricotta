# Ricotta Orders

Restaurant orders, suppliers, items, units, Records, device controls and Rico chat. The static web app supports English, Kurdish and Arabic. GitHub Pages serves the app; Supabase runs the database and the `api` and `send-push` Edge Functions.

## Data and sign-in

Two named accounts use server-verified PINs. Browser requests use revocable session tokens. Database tables and internal helpers are restricted to `service_role`; never put that key in the browser or commit it.

Order History and Records retain the current **Asia/Baghdad calendar month**. Older orders, their lines and Records are permanently deleted at Baghdad midnight by `ricotta-monthly-history`; the daily cleanup catches up after downtime. The API also filters reads by month. The October 2026 rollout keeps October 1–7, removes earlier months and clears all saved sessions/devices/push registrations once. People must sign in and re-enable notifications afterward. PINs, the catalog and reminder settings are kept.

Orders retry with stable IDs. Each pending order has its own local storage entry so tabs cannot overwrite one shared queue. Settings shows the pending count, Retry sync and Export copy. Export a previous month's unsynced order before clearing browser storage: it cannot be written into a later month's history.

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

Tests use mocked network requests and disposable PGlite/PostgreSQL databases. They do not access restaurant data. Database tests cover monthly cutoffs, cascading order-line deletion, audit rollback, session revocation, chat ownership, idempotent saves and restricted helper permissions.

## Database bootstrap and deployment

`supabase/baseline.sql` is a verified schema-only snapshot of the retained tables/functions. On an **empty Supabase project**, enable `pgcrypto` and `pg_cron`, apply the baseline, then the SQL in `supabase/migrations/` in filename order. Configure the two account rows with privately generated bcrypt PIN hashes, recovery hashes and push/AI secrets. Do not use sample credentials in production.

The earlier migration chain mixed removed features with missing live migrations. It has been replaced in the repository by this baseline. Existing production migration history remains intact. Do not replay the baseline on production or repair its applied history merely to match filenames. Future migrations extend this baseline.

On the existing project, apply only the new migration. It deliberately drops the retired feature objects and performs the one-time session/device reset. Deploy both Edge Functions with JWT verification disabled because they verify their own PIN sessions or cron secret. `send-push` requires `x-cron-secret`; the existing minute tick remains configured. Update `APP_VERSION` whenever deploying browser changes.

## Backups and recovery

Keep encrypted database backups outside the repository and browser. Supabase's backup availability depends on the project's plan; check the dashboard and use an external backup if necessary. Review the retention policy before restoring: normal cleanup immediately removes data from previous months. Restore business backups to a separate project first, verify catalog and current-month order counts, then redeploy functions and revoke restored sessions before switching traffic. `pnpm test` verifies that the schema baseline restores into an empty database; it is not a production-data recovery drill.
