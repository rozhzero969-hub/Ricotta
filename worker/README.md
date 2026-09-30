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
- `start-launcher.cmd` runs `launcher.mjs`, a tiny helper that stays on all the time. When someone presses **Turn on the worker** in the app (Transfer screen), the launcher opens `start-worker.cmd` on this PC. Leave the PC on and signed in to Windows; the launcher is what lets you start the worker from far away.
- Screenshots are kept in the app for 3 days and then deleted automatically.

Item and unit names must match the workplace page **exactly**; the PC stops and says so when they do not.
