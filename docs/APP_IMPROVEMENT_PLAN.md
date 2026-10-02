# Ricotta improvement review — 1–2 October 2026

Repository: `rozhzero969-hub/Ricotta`. Database: `ricotta-orders` (`pxufdcyqjtmtklmrjodg`).
This review covered the connected schema, deployed function sources, authorization,
order persistence, stock/receipt workflows, office worker, and the browser app.
It does not establish that every possible bug has been found.

## Current release status

The `20261001230232_atomic_app_writes` migration is applied to Supabase. Its five
new RPC helpers allow only the service role, use invoker security and fixed search
paths, and passed a live transaction test whose fixture data was rolled back.
The obsolete seven-argument `transfer_recount` function was removed; its tables
had already been removed. The active-item job uniqueness constraint is installed.

The `20261002050525_restaurant_expenses` migration is also applied. It adds a
paid-expense ledger and immutable audit events, exact IQD/USD amounts, service-only
atomic writes, revision conflicts and separate filtered currency totals. Both
Rozha and Yunis have full access, as requested. Live checks rolled back their
fixtures; no sample financial records remain. See [the expense guide](RESTAURANT_EXPENSES.md).

Frontend, Edge Function and office-worker changes are staged in the accompanying
GitHub pull request. They require a coordinated release. Existing deployed Edge
Function sources matched the repository's starting commit, and were not replaced
during this review.

## Verified changes

- Order headers, lines and stock-estimate increments save in one transaction.
  Stable order IDs make simultaneous retries safe. Daily estimate decay adds to
  the same current value and runs once per date.
- Counting and recipe-unit settings save together; validation failures roll back
  both settings and their audit events.
- PIN and assistant quotas reserve an attempt before expensive work, serialize
  competing requests, and deny access when the database is unavailable.
- Request bodies are limited by actual UTF-8 bytes while streaming. Push endpoints
  are restricted to supported providers, preventing arbitrary server requests.
- Recovery capabilities advance once. Session expiry and push subscription
  ownership are checked on the server. Expired sessions receive no reminders.
- Rico proposes stock estimate changes and waits for confirmation before saving.
- Orders are queued before sending, retain their originating account, and survive
  same-tab asynchronous flushes and ambiguous responses. Storage-full failures
  are reported accurately. Old responses cannot change a new session.
- Logout clears account data, chat, receipt drafts and screenshots from memory.
  Other tabs' session changes reset the old account's UI while preserving the new
  shared session. Cart drafts are scoped to their account. Failed order saves retain
  a stable retry and draft. Action buttons prevent duplicate saves.
- Modal focus, keyboard navigation, screen-reader status and saving feedback are
  improved. Motion honors reduced-motion settings. Browser pinch zoom is enabled.
- Office-worker preparation claims have one winner and reject stale reports.
  Ambiguous workplace clicks require manual checking. Numeric readback rejects
  negative or malformed values. Atomic process locks prevent competing workers.
- Idle worker polling backs off to one minute; prepared approvals remain responsive.
  Duplicate browser stock reads are coalesced. Dependency versions are pinned and
  Deno resolution is locked; Dependabot checks worker and Actions updates weekly.

## Validation

Frozen Deno type checking, undefined-name lint, 37 storage/update regressions,
account/save-recovery checks, mocked API/security/push/provider checks, stock API
checks, process-lock checks and polling checks passed. Disposable Postgres tests
verified rollback behavior and 12 competing requests for order retries, stock
increments, daily decay and quota reservations. The live RPC test rolled back
its fixture data and verified browser-role denial and service-role access.

Expense API and SQL checks passed, including immutable audit permissions, supplier
snapshots, failed-audit rollback, aggregate totals above JavaScript's safe integer
range, and 12 competing create/edit/void requests. Expense tables follow the same
server-only access model; the post-migration security advisor has no warning/error
findings and 34 informational RLS-without-policy notices.

The expense browser suite passed exact IQD/USD formatting, create/edit/void,
inspectable changes, durable retry after reload, storage-full and rate-limit
handling, account isolation, snapshot-consistent CSV and EN/KU/AR layouts. Final
integration checks also passed the 54-layout/6-sign-in UI subset and the complete
stock/transfer suite. Desktop English and phone Arabic previews were inspected.

The full browser suite passed 162 workspace layouts and 18 sign-in layouts across
six widths in English, Kurdish and Arabic, including nested dialogs, keyboard
focus and reduced motion. Stock/transfer checks passed both accounts and all three
languages at three widths, including explicit stock-count confirmation, duplicate
save prevention and rejection of stale session responses.

Receipt and ingredient-worker browser fixtures passed. They fill and re-check
every submitted field, reject missing or ambiguous matches, and require an exact
success message after a single click. These tests submit only local fixture forms.

## Database and budget findings

At inspection the database used about **31 MB**, with **48 orders**, **393 order
lines** and no transfer screenshots. All **32 app tables** had RLS enabled, no
browser-role table grants, and no policies. That is intentional: browsers use the
PIN-authenticated Edge Functions, while only the server accesses these tables.
Do not add permissive policies simply to silence the
[informational advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

The security advisor reported no warning/error findings. The performance advisor
listed 16 unused indexes, all informational. These support relationships, active
sessions or newer workflows; this young project's usage counters are insufficient
evidence to delete them. The last 24 hours had 1,441 successful scheduled runs.

[Supabase Free includes 500,000 Edge invocations](https://supabase.com/docs/guides/functions/pricing).
The old worker could poll four endpoints every five seconds, around 2.1 million
calls per 30 days if always on, before launcher, heartbeat, cron and phones.
The new idle cadence is roughly 300,000 worker/launcher calls per month under
continuous idle operation; active tasks and browser calls add to that. Pickup
can take about one minute. Check actual organization usage; this is an estimate,
not a guarantee of staying within the quota. No paid tier, service or feature
was enabled by this work.

## Coordinated rollout

1. Finish or reconcile pending workplace actions, then stop the office worker
   and launcher. Preserve `worker/.env` and the browser profile.
2. Confirm the applied migration appears in `supabase migration list`. Do not
   reapply a migration already recorded on the live project.
   Both `atomic_app_writes` and `restaurant_expenses` are already recorded.
3. Copy the updated worker files to the PC. Deploy matching `api`, `stock-api`
   and `send-push` sources, including `_shared/security.ts`. Keep the existing
   JWT settings: custom authentication for `api`/`stock-api`, JWT verification
   for `send-push`. Publish the frontend together with its confirmation UI.
4. Restart the worker. Run a supervised preparation and screenshot check before
   enabling any workplace submission. Existing final approval remains mandatory.
5. Verify login, queued order retry, item-settings save, stock proposal confirmation,
   reminders and worker health. Verify Expenses for both accounts, IQD/USD totals,
   edit history, void exclusion, unconfirmed-save recovery and CSV export. The
   offline tests do not submit real workplace forms.

## Next work, using free capabilities

| Priority | Planned improvement | Completion criterion |
| --- | --- | --- |
| Next | Pending-sync badge, retry button and downloadable JSON export | Offline orders remain visible after bootstrap and can be exported when storage is unavailable. |
| Next | IndexedDB transactional outbox with Web Locks | Two tabs cannot lose or duplicate a queued mutation; account ownership remains intact. |
| Next | Recover abandoned receipt/item submissions into Needs checking | A crashed worker's submission becomes reconcilable; uncertain actions are never automatically repeated. |
| Next | Quota review and adaptive browser polling | Usage remains below the free quota with headroom for every active device. |
| Soon | Routine encrypted local exports and a restore drill | An export can restore catalog/history in a disposable database. Avoid depending on paid backup features. |
| Soon | GitHub CodeQL and native secret scanning | Public-repository scanning runs with read-only source permissions and detects deliberately seeded test issues. Check existing/default scanning setup first. |
| Soon | Supabase Postgres maintenance upgrade | Review the current 17.6 project against Supabase's 17.11 guidance, export first, and choose a restart window. [Upgrade notes](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes). |
| Later | Stronger per-person authentication | Replace shared six-digit credentials with individual access while preserving the kitchen's quick sign-in flow. |

No additional plugin is required to ship these fixes. **Codex Security** is an
optional plugin for deeper repository vulnerability reviews; its availability
and pricing should be checked before adding it. GitHub's public-repository
security tools and existing Supabase advisors can support the immediate plan.
