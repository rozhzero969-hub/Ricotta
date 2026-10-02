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
- The launcher (`launcher.mjs`) runs with no window, so it cannot be closed with the X. `install-startup-task.ps1` starts it at sign-in and again every 5 minutes if it has stopped. When someone presses **Turn on the worker** in the app (Transfer screen), it opens `start-worker.cmd`. So if the worker window is closed, the app can always open it again. Leave the PC on and signed in to Windows. The launcher writes to `launcher.log` in this folder.
- Screenshots are kept in the app for 3 days and then deleted automatically.

Item and unit names must match the workplace page **exactly**; the PC stops and says so when they do not.

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

Record the current `ALLOW_SUBMIT` value and temporarily set it to `0` for the first supervised preparation and screenshot check. Restore the previous value only after those checks pass.

The stock settings API also requires the `stock_save_item_settings` database migration before the new function is deployed. Counting and recipe settings then save in one transaction.

If a click returns an error after it may have reached the browser, the task now requires a workplace check. A person confirms whether it was saved before any further action.

The worker and launcher use atomic lock files. A running process keeps its lock even if its heartbeat is delayed. If a crash interrupts lock recovery, the diagnostic identifies a `.lock.recovery` directory; stop all workers before removing that directory and restarting. `scripts/worker-lock-smoke.mjs` tests competing starts without opening the workplace site.

Empty queues gradually back off to a 60-second poll to reduce free-plan Edge Function usage. A new task can take up to about one minute to be picked up; a prepared receipt or ingredient still uses `POLL_SECONDS` (5 seconds by default) while waiting for approval. The launcher checks start requests every 30 seconds. A continuously idle PC uses roughly 300,000 Edge calls per 30-day month, including the launcher and heartbeat; active tasks and phone refreshes add usage. `scripts/worker-polling-smoke.mjs` verifies the timing without real waits.
