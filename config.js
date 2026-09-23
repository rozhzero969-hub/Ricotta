/* App-wide constants: Supabase connection, default units, and PIN length
   rules. Must load before app.js (app.js reads these while building its
   initial state object). */

/* Bump this string every time you push a code change (any change to any
   file). The update checker in update-check.js compares this against the
   live copy on the server and prompts users to reload when they differ.
   Any unique value works -- date-based is easiest to keep straight. */
const APP_VERSION = '2026-09-23.1';

/* One-line summary of what changed in this version, shown (in both
   languages, regardless of the reader's chosen app language) in the
   update popup. update-check.js pulls these out of this file with a
   simple regex -- it never runs the file, just reads it as text -- so
   keep each one to a single line with no stray quote characters inside
   it. Update both whenever you bump APP_VERSION above. */
const CHANGELOG_EN = 'A new Ricotta loading screen, faster sign-in with no page reload, a smoother and more polished look, and many reliability fixes: deleted items and units now stay deleted, notifications and reminders work again, remote log out and refresh work instantly, and orders are kept safely even when the Wi-Fi drops.';
const CHANGELOG_KU = 'شاشەیەکی نوێی بارکردنی ریکۆتا، چوونەژوورەوەی خێراتر بەبێ نوێکردنەوەی پەڕە، ڕووکارێکی ڕێکتر و جوانتر، و چاککردنی زۆر: کاڵا و یەکە سڕاوەکان ئیتر ناگەڕێنەوە، ئاگادارکردنەوە و بیرخەرەوەکان دووبارە کار دەکەن، چوونەدەرەوە و نوێکردنەوەی دوور دەستبەجێ کار دەکەن، و داواکارییەکان بە سەلامەتی هەڵدەگیرێن تەنانەت کاتێک وایفای دەپچڕێت.';

/* Supabase project this app talks to. The browser only ever calls this
   project's `api` Edge Function (with a session token issued after a PIN
   check); it has no direct database access, and no secret lives here. */
const SUPABASE_URL = 'https://pxufdcyqjtmtklmrjodg.supabase.co';

/* Web Push (notifications). This is the PUBLIC half of your VAPID key pair,
   which is meant to be shipped to the browser. Generate the pair with
   `npx web-push generate-vapid-keys`, paste the public key here, and store
   the private key ONLY as an Edge Function secret (never in this file).
   Until this is replaced, the notification banner stays hidden. */
const VAPID_PUBLIC_KEY = 'BJS1Qg-S1h6PJIp3JthweEJuG9sFZD-_-vsBKA44ZmWAWXzky9LUjJ57lUnWmCNRrp8YNNv8nFWCmr1PtC1WLRY';

const DEFAULT_UNITS = [
  {id:'kg', en:'kg', ku:'کیلۆگرام'},
  {id:'g', en:'g', ku:'گرام'},
  {id:'l', en:'liter', ku:'لیتر'},
  {id:'ml', en:'ml', ku:'میلی لیتر'},
  {id:'piece', en:'piece', ku:'دانە'},
  {id:'carton', en:'carton', ku:'کارتۆن'},
  {id:'box', en:'box', ku:'سندوق'},
  {id:'pack', en:'pack', ku:'پاکەت'},
  {id:'dozen', en:'dozen', ku:'دووازدە'},
  {id:'bag', en:'bag', ku:'کیسە'},
  {id:'sack', en:'sack', ku:'گونی'},
  {id:'bottle', en:'bottle', ku:'بوتڵ'},
  {id:'can', en:'can', ku:'قوتی'},
  {id:'tray', en:'tray', ku:'سینی'},
  {id:'roll', en:'roll', ku:'رۆڵ'},
  {id:'bunch', en:'bunch', ku:'دەستە'},
  {id:'meter', en:'meter', ku:'مەتر'},
  {id:'set', en:'set', ku:'سێت'}
];

const MAX_PIN_LEN = 6;   /* both admin and staff PINs are six digits */
