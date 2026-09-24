# UI smoke check

With Node.js and Playwright available, run `node scripts/ui-smoke.cjs` from the repository root. On Windows it uses the installed Microsoft Edge; otherwise Playwright uses its Chromium installation. Set `EDGE_PATH` to override the browser executable.

The script serves the local source on a temporary loopback port and mocks all API responses with a synthetic 181-item catalog. It never logs into the production app or writes to the database. It checks six widths in English and Kurdish, keyboard/focus stability, supplier switching, draft persistence, and reduced motion. Screenshots are saved in a new temporary directory printed on success. Browser and server are closed when the checks finish.

`design/ricotta-ui-direction.html` is the standalone visual reference used for this release. It contains illustrative products only.
