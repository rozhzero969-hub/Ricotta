/* App-wide constants: Supabase connection, default units, and PIN length
   rules. Must load before app.js (app.js reads these while building its
   initial state object). */

/* Bump this string every time you push a code change (any change to any
   file). The update checker in update-check.js compares this against the
   live copy on the server and prompts users to reload when they differ.
   Any unique value works -- date-based is easiest to keep straight. */
const APP_VERSION = '2026-09-20.1';

/* One-line summary of what changed in this version, shown (in both
   languages, regardless of the reader's chosen app language) in the
   update popup. update-check.js pulls these out of this file with a
   simple regex -- it never runs the file, just reads it as text -- so
   keep each one to a single line with no stray quote characters inside
   it. Update both whenever you bump APP_VERSION above. */
const CHANGELOG_EN = 'Notifications: daily order reminder and update alerts. Turn them on from the banner on the Order screen.';
const CHANGELOG_KU = 'ئاگادارکردنەوەکان: بیرخەرەوەی ڕۆژانەی داواکاری و ئاگاداری نوێکاری. لە بانەری شاشەی داواکاری چالاکیان بکە.';

/* Supabase project this app talks to. The key below is the anon/public
   key, which is DESIGNED to be shipped to the browser -- Supabase's
   client-side model protects data through Row Level Security (RLS)
   policies on the server, not by keeping this key secret. Real secrets
   (login PINs, the cloud-setup password) are never stored in this file;
   they live only in the database and are checked through the
   app_verify_pin / app_get_cloud_config / app_set_pins / app_set_cloud_config
   / app_get_pins SQL functions, which return a yes/no or a role name --
   never the stored value itself, unless the caller already proved they
   know it. See ricotta-supabase-setup.sql for those policies/functions. */
const SUPABASE_URL = 'https://pxufdcyqjtmtklmrjodg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4dWZkY3lxanRtdGtsbXJqb2RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MTkyMDUsImV4cCI6MjEwNTA5NTIwNX0.3INIUO57uUR5F1-Fqg0jZqkS4T97iGGogbIzxWd3Ho0';

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

const ADMIN_PIN_LEN = 6;
const USER_PIN_LEN = 4;
const MAX_PIN_LEN = 6;
