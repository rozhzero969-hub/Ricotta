# Rico on the Mac

Rico enters receipts from Ricotta Orders into Ricotta Restaurant, the way a person does, in a browser
window of his own. Ricotta Restaurant is another team's app with no API for us, so this is the only way.

## Once

```bash
node helper/setup.mjs
```

It asks for the Ricotta Restaurant username, password and PIN (not shown while typed) and keeps them in
this Mac's Keychain only. It also makes Rico's own token for the Ricotta Orders API and sends it to
Supabase as the `RICO_HELPER_TOKEN` secret (the Supabase command line must already be signed in).

## Every day

```bash
node helper/rico-helper.mjs
```

A full-screen window opens on Ricotta Restaurant. Rico reads its suppliers, zones and purchased items
for the app (again every 10 minutes, and straight away when someone presses Check now in the app),
then takes receipts one at a time: fills in New receipt, reads every box back, checks the
totals, photographs it and waits for approval in the app (or saves by himself when Settings says so),
presses Receive & send to finance, and finds the receipt in Invoices for its finance number. Close the
window or press Ctrl+C to stop him; a receipt he was in the middle of is shown as stopped, never retried.

`node helper/rico-helper.mjs --practice` does everything except save: each receipt is filled in,
photographed and discarded, and shows as stopped with "Practice run" in the app.

He never presses Add expense item, Return, Waste, the delivery or missing-item buttons in Invoices, or
anything that edits or deletes, and never touches a half-made receipt that was already open.
