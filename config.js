/* App-wide constants: default units/settings and PIN length rules.
   Must load before app.js (app.js reads DEFAULT_SETTINGS while
   building its initial state object). */
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
const DEFAULT_SETTINGS = {
  adminPin:'123456', userPin:'1111', cloudPassword:'setup2026',
  supabaseUrl:'https://pxufdcyqjtmtklmrjodg.supabase.co',
  supabaseKey:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4dWZkY3lxanRtdGtsbXJqb2RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MTkyMDUsImV4cCI6MjEwNTA5NTIwNX0.3INIUO57uUR5F1-Fqg0jZqkS4T97iGGogbIzxWd3Ho0'
};
const ADMIN_PIN_LEN = 6;
const USER_PIN_LEN = 4;
const MAX_PIN_LEN = 6;
