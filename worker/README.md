# Office PC worker

Runs on the office PC. It checks each waiting transfer against the workplace
**Move between storages** page (filling the form without clicking **Move it**),
sends a screenshot to the app, and only after Rozha or Yunis gives a final approval
does it click **Move it**.

- `worker/.env` holds the private worker token and settings. It is never committed.
  Copy `.env.example` to `.env`. `ALLOW_SUBMIT=0` checks only; `ALLOW_SUBMIT=1` allows the
  final-approved click. `CONFIRMED_SUCCESS_TEXT=Moved!` is the workplace success message.
- Start with `start-worker.cmd` (restarts after a crash). `node status.mjs` says whether it is running.
- `install-startup-task.ps1` starts it at Windows sign-in, together with the launcher.
- The launcher (`launcher.mjs`) runs with no window, so it cannot be closed with the X. `install-startup-task.ps1` starts it at sign-in and again every minute if it has stopped (and when the PC is unlocked). When someone presses **Turn on the worker** in the app (Transfer screen), it opens `start-worker.cmd`. So if the worker window is closed, the app can always open it again. Leave the PC on and signed in to Windows (the setup script turns off sleep while plugged in). If the PC is off, asleep or signed out, **Turn on the worker** is kept and the worker starts as soon as the PC is back. The launcher writes to `launcher.log` in this folder.
- Screenshots are kept in the app for 3 days and then deleted automatically.

Item and unit names must match the workplace page **exactly**; the PC stops and says so when they do not.

## Signing in to the workplace by itself

If the workplace site shows its sign-in page, the worker signs in with the PIN keypad (`signin.mjs`) and sends a screenshot to the phones. Put the workplace PIN in `worker/.env` as `WORKPLACE_PIN=` (only there: never in the app, GitHub or a message). It tries at most once every 10 minutes and stops after 3 failed tries until someone presses **Check sign-in** in the app (under the PC worker bar on Transfers and Receipts).

## When the worker does not start

If the worker cannot start (its Edge window is still open from before, Edge cannot open, or a setting is missing), it tells the app why, and the PC worker bar shows **The PC says: …**. If the worker window opens but the worker never reports in, the launcher says so after 3 minutes. A lock file left from before the PC restarted no longer stops the worker.

## Receipts

Receipts are entered in the app (Receipts screen). Every item on a receipt must be set up for stock (its counting format), so the amount can be added to stock in counting units.

1. The worker opens the workplace **New purchase receipt** page (`receipt.mjs`) in a second Edge tab and fills in the supplier, invoice number, dollar rate (if USD), delivery (if any) and each item line (item, unit, quantity, cost of each). It checks every field and each line total, then sends a screenshot to the app and stops.
2. Someone checks the screenshot in the app and gives the **final approval** (within 20 minutes).
3. The worker reads the whole form back again, and only if every field still matches does it press **Receive & send to finance**, once. It never retries after pressing.
4. Only when the workplace shows the exact `RECEIPT_SUCCESS_TEXT` is the receipt marked saved and the stock added to **Main Storage** in the app. Anything else after the press becomes **Needs checking**: a person looks in the workplace receipts and says in the app whether it was saved; only "saved" adds stock.

Receipts are only saved with `ALLOW_SUBMIT=1` **and** `RECEIPT_SUCCESS_TEXT` set in `.env` (learned in a supervised first run). Until then the app shows the worker as test mode for receipts and the final approval stays off. If someone finishes or leaves a filled receipt on the PC by hand, it becomes Needs checking. If anything doesn't match exactly (an unknown item, supplier or unit, a unit with two different sizes, or a field changed after filling), it stops and clears the form. `scripts/receipt-worker-smoke.mjs` tests all of this against a local copy of the page.

## Ingredients (add or edit in the workplace)

In the app, open an item (Items screen) and fill in its stock fields, including the **recipe (usage) unit** and how many usage units are in one counting unit. Then press **Create in workplace** (new ingredient) or **Update in workplace** (an ingredient already there).

1. The worker opens the workplace **Stock** page (`items.mjs`) in its own Edge tab. To add, it first makes sure no ingredient with that name exists. To edit, it finds the row by its exact workplace name and opens the pen.
2. It fills in the name, usage unit (new ingredients only, because the workplace locks it once there is stock), buying and counting formats, the conversion boxes and the warning level. It reads everything back, sends a screenshot to the app and stops.
3. Someone checks the screenshot and gives the **final approval** (within 20 minutes). The worker checks the whole form again and presses **Add ingredient** or **Save** once. It never retries.
4. Only the exact `ITEM_ADD_SUCCESS_TEXT` or `ITEM_EDIT_SUCCESS_TEXT` counts as saved. Anything else becomes **Needs checking**, and a person confirms in the app whether it was saved.

On an edit, the worker never changes the usage unit. If the app's usage unit differs from the workplace's, it stops. Ingredients are only saved with `ALLOW_SUBMIT=1` and both success texts set in `.env`. `scripts/items-worker-smoke.mjs` tests this against a local copy of the page.

## Updating the worker and API together

The updated receipt and ingredient preparation protocol returns a `claimToken` and requires it on preparation reports. This prevents an old preparation attempt from overwriting a task reclaimed by another worker. Temporarily disable both Windows scheduled tasks, `Ricotta Transfer Worker` and `Ricotta Worker Launcher`, then stop their worker/launcher process trees, including the CMD restart wrappers. Preserve `.env` and the browser profile, copy the updated `worker/` files to the PC, and deploy the matching `stock-api` and frontend. Re-enable the two tasks and restart the worker only after those updates are complete. Do not deploy this API version while an older office worker is still running. Existing final approvals still gate every workplace submission.

Before restarting for the first supervised preparation, record the current `ALLOW_SUBMIT` value and temporarily set it to `0`. Run the preparation and screenshot check, then restore the previous value only after those checks pass and restart the worker to load it.

The stock settings API also requires the `stock_save_item_settings` database migration before the new function is deployed. Counting and recipe settings then save in one transaction.

If a click returns an error after it may have reached the browser, the task now requires a workplace check. A person confirms whether it was saved before any further action.

The worker and launcher use atomic lock files. A running process keeps its lock even if its heartbeat is delayed. If a crash interrupts lock recovery, the diagnostic identifies a `.lock.recovery` directory; stop all workers before removing that directory and restarting. `scripts/worker-lock-smoke.mjs` tests competing starts without opening the workplace site.

New work starts within about a second. Instead of checking every minute, the worker keeps one question open with the server (`worker/wait`), and the server answers it the moment there is something to do (a transfer to check or move, a receipt or ingredient to fill in, a sign-in check). The launcher does the same for **Turn on the worker**. A quiet PC makes roughly 170 calls an hour (one held-open question about every 25 seconds plus a health report every 90 seconds), fewer than the old one-minute checks, so it stays within the free plan. While a filled-in form waits for its final approval, the worker checks every `POLL_SECONDS` (5 seconds by default). Filling forms waits for the page itself (lists, new lines, totals) instead of fixed pauses. `scripts/worker-polling-smoke.mjs` checks the waiting rules.
