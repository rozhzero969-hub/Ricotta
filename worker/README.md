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
