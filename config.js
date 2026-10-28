/* App-wide constants: version, Supabase connection, default units and PIN
   length. Must load before app.js (app.js reads these while building its
   initial state object). */

/* Bump this string every time you push a code change (any change to any
   file). The update checker in update-check.js compares this against the
   live copy on the server and reloads (or asks, when an order is in
   progress) when they differ. Any unique value works -- date-based is
   easiest to keep straight. */
const APP_VERSION = '2026-10-28.5';

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

/* Only used if the server has no units at all. A unit has one name, in any language (ROZH-23). */
const DEFAULT_UNITS = [
  {id:'kg', en:'کیلۆگرام'},
  {id:'g', en:'گرام'},
  {id:'l', en:'لیتر'},
  {id:'piece', en:'دانە'},
  {id:'carton', en:'کارتۆن'},
  {id:'box', en:'سندوق'},
  {id:'pack', en:'پاکەت'},
  {id:'bag', en:'کیسە'},
  {id:'bottle', en:'بوتڵ'},
  {id:'can', en:'قوتی'},
  {id:'tray', en:'سینی'},
  {id:'bunch', en:'دەستە'}
];

const MAX_PIN_LEN = 6;   /* both PINs are six digits */
