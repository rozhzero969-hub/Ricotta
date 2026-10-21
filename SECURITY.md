# Security and deployment

Report vulnerabilities privately through GitHub's Security tab. Never include credentials or restaurant data in a public issue.

## Trust boundary

The public browser app talks only to the `api` Edge Function. PIN checks, account permissions, data ownership and request limits are enforced on the server. Hiding a tab is not authorization. Rozha manages PINs, devices, provider setup and update broadcasts. Yunis cannot use those administrative endpoints. Shared catalog and kitchen history remain shared by design; both accounts can read/delete saved chats, but only write their own. Yunis may undo their own order within 15 minutes; other history deletion is restricted to Rozha.

PINs are salted bcrypt hashes with cost 12. A PIN changes only through Admin with Rozha's current PIN; a wrong current PIN counts toward the same failed-sign-in limits. Sessions use random bearer tokens; only SHA-256 token hashes are stored in the database, and every request checks expiry/revocation. Cloudflare tokens are verified on the server for hostname, action and single use. The functions intentionally use `verify_jwt=false`: the API verifies its own sessions, and the push function requires the private cron secret.

All app tables have RLS enabled and no grants to public/anon/authenticated. Device IDs are not credentials: sessions must match the device account, heartbeats cannot change ownership, and sign-in cannot claim a device with an active session from another account. Internal device IDs are excluded from shared activity responses.

The lack of browser RLS policies is intentional: the browser has no direct table/RPC access. Only server roles may call internal database functions. Do not add permissive policies to silence the informational advisor message.

## Secrets and browser storage

No service-role, AI-provider, Turnstile secret, database URL/password, cron secret or VAPID private key belongs in browser code or Git. Server environment variables stay in Supabase's encrypted secret settings; AI keys currently reside in the server-only secrets table. Public VAPID keys, Turnstile site keys and the project URL are public identifiers, not credentials.

Sessions remain in localStorage to support the existing installed app and reload behavior. This makes XSS prevention important: text/attributes must be escaped, dynamic class names must be allowlisted, and the page CSP must stay strict. Moving to HttpOnly cookies requires a same-site backend/hosting change and CSRF protection; do not simply move the current token into an unprotected cookie.

## Request limits

Atomic database reservations persist across Edge instances and devices. Each account gets 240 reads and 600 writes per minute (the write budget permits the 500-row catalog importer), with additional limits of 6 push requests and 40 chat saves per minute. Logout stays available when a quota is exhausted. Login has a pre-verification global/IP budget, plus the existing atomic failed-PIN global/IP limits. Rico retains its separate hourly provider quotas. Quota failures fail closed; throttled requests return 429 with Retry-After. These application limits are not a replacement for network-level DDoS protection.

Foreign browser origins and non-JSON writes are rejected before routing; a missing Origin still requires normal authentication. CORS is not an authentication mechanism. API responses have no-store, nosniff, DENY framing, no-referrer, HSTS and a document-blocking CSP, including streamed responses.

## Publishing and continuous checks

`node scripts/build-site.cjs` creates an allowlisted `dist/` artifact. GitHub Pages must use **GitHub Actions** as its source. Backend TypeScript, SQL migrations, tests, lab pages, dependency files and local/private exports are excluded. The shared browser search helper is included in the minified browser bundle. Content-hashed assets are cached by the service worker; HTML, config.js, API replies and user data are excluded from that cache. The repository itself is public: hiding files from the published site does not make repository source private.

GitHub Pages supplies HTTPS/HSTS but does not support arbitrary response headers. The frontend CSP/referrer policy are supplied as meta tags; an embedded app refuses to render its sign-in/workspace as defense in depth. A true frame-ancestors header, Permissions-Policy and frontend nosniff header require a host/proxy that supports headers. Do not claim that a `_headers` file works on GitHub Pages. A hosting move must also update CORS, Turnstile hostnames, installed-app behavior and deployment settings.

CI runs application/security regressions, dependency advisory checks and redacted Gitleaks scans; GitHub CodeQL and Dependabot provide ongoing scanning. Actions are pinned to reviewed commit SHAs. `.gitleaksignore` contains only exact reviewed historical public anon-key fingerprints and retired defaults verified not to match any current account PIN hash. New matches must be investigated, never broadly ignored.

## Operational limits

A six-digit shared account PIN offers less protection than a strong password with MFA; Cloudflare and limits reduce online guessing but do not eliminate phishing or stolen-device risk. Keep GitHub, Supabase and Cloudflare owner accounts protected with MFA. A static scan cannot prove absence of compromise or guarantee future safety. If a real secret is exposed, revoke/rotate it first; deleting it from a file is insufficient. Coordinate any Git-history rewrite with all collaborators.
