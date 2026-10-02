# Restaurant expenses

Rozha and Yunis both have full access to the Expenses screen: add, view, edit,
void and export. Each saved change records the authenticated account and time.
Rozha and Yunis already use separate sign-ins, each with their own private PIN.

## Recording spending

Open **Expenses** from More or the desktop sidebar. You can also choose it in
Edit tabs. Press **Add expense**, then enter the payment date, description,
category, currency, amount and payment method. Supplier and notes are optional.

Record the money paid once. Orders and workplace receipts do not automatically
add entries here. If you record a food purchase when you pay for it, that payment
is already included; entering it again as a supplier payment would duplicate it.

Examples: vegetables for **35,000 IQD**, or ingredients for **12.50 USD**. IQD uses
whole dinars; USD accepts up to two decimal places. The app keeps the original
currency and displays separate totals. It does not choose an exchange rate.

The screen starts with the current month in Baghdad time. Date, category,
currency and status filters change both the list and the spending summaries.
Totals cover every matching active expense, including entries beyond the first
page. Voided entries remain in the ledger and are excluded from spending.

## Corrections and history

Use **Edit** to correct an entry. If another device changed it first, refresh and
review that change before trying again. Use **Void** with a reason for an entry
that should not count as spending. **Changes** shows who changed it and the
values before and after the change. The app preserves the original audit trail.

## Lost connections

The app stores an unconfirmed save on the originating account's device before
sending it. Retry the entry from the recovery card; retries reuse its reference
and cannot create a second copy. Reloading or signing back into the same account
keeps that recovery available. New expense creation is blocked while an earlier
creation is unresolved. A storage-full error leaves the entry unsent.

This recovery protects saves started online. The app requires the server to load
the ledger and confirm writes; it does not automatically send a financial entry
in the background.

## Export and release

CSV exports include all matching entries and their original currencies. If the
ledger changes during an export, the app asks you to export again so one file
cannot combine different versions. Spreadsheet formula prefixes are escaped.

The `20261002050525_restaurant_expenses` migration is applied to Supabase. Its
tables and RPCs are restricted to the service role, with RLS enabled and no
browser table grants. Database verification used rolled-back fixtures and left
no sample spending. The UI and API are prepared in the coordinated release PR.
Follow [the rollout plan](APP_IMPROVEMENT_PLAN.md#coordinated-rollout), including
the matching office-PC worker update.
