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

## Receipts (prepared only)

Receipts are entered in the app (Receipts screen). The worker opens the workplace **New purchase receipt** page (`receipt.mjs`) in a second Edge tab and fills in the supplier, invoice number, dollar rate (if USD), delivery (if any) and each item line (item, unit, quantity, cost of each), checking every field and each line total. It then **stops**: it never presses **Receive & send to finance**. A person at the PC checks the filled form and accepts it there. While that tab is still open on the receipt page, the next receipt waits. If anything doesn't match exactly (an unknown item, supplier or unit, or a unit with two different sizes), it stops, sends a screenshot to the app and resets the tab to an empty form. `scripts/receipt-worker-smoke.mjs` tests this against a local copy of the page.
