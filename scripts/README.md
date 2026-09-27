# Checks

Both checks also run on every pull request (`.github/workflows/checks.yml`).

## UI smoke check

With Node.js and Playwright available, run `node scripts/ui-smoke.cjs` from the repository root. On Windows it uses the installed Microsoft Edge; otherwise Playwright uses its Chromium installation. Set `EDGE_PATH` to override the browser executable.

The script serves the local source on a temporary loopback port and mocks all API responses with a synthetic 181-item catalog. It never logs into the production app or writes to the database. It signs in as Rozha and as Yunis (and runs the secret-code steps) against that mock, and checks six widths in English, Kurdish and Arabic, the language menu, the computer sidebar, each account's screens, page transitions and swipes, Rico's moods, messages and voice recording, the update notification, keyboard/focus stability, the sounds, phone typing and centred popups, the Home Screen app frame, supplier switching, draft persistence, and reduced motion. Screenshots are saved in a new temporary directory printed on success. Browser and server are closed when the checks finish.

## Rico check

`node --experimental-strip-types scripts/rico-provider-smoke.mjs` runs Rico's server code (`supabase/functions/api/assistant.ts`) against a fake database and fake AI providers: tool calls, moods in any tag shape, Kurdish going to Gemini first, fallbacks between models and providers, and the quick answers.
