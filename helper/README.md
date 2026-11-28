# Rico on the Mac

Rico uses a browser on the Mac to enter Ricotta Orders receipts and transfers in Ricotta Restaurant.

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

Open **Watch Rico** from Receipts or Transfers on the Mac running the helper to see its live browser
view. Allow local network access if the browser asks. To use a separate full-screen browser window,
turn off **Show Rico inside Orders** in Settings before the next start.

Rico reads suppliers, zones and purchased items every 5 minutes and when someone presses **Check now**.
For each receipt, he fills in the form, checks the fields and totals, takes a photo and waits for
approval, or saves automatically if Settings allows it. He then sends it to finance and looks up the
finance number in Invoices.

Use **Stop Rico** in the app or Ctrl+C in the terminal where you started him. An interrupted receipt
is shown as stopped and requires review before another attempt.

`node helper/rico-helper.mjs --practice` does everything except save: each receipt is filled in,
photographed and discarded, and shows as stopped with "Practice run" in the app.

**Retry** keeps the existing receipt in Orders. Rico clears the matching unsaved Restaurant draft,
fills it again, and sends a new photo for approval. Forms that belong to another receipt stay in place.
