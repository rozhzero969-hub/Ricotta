/* Ricotta Orders -- problem reports and time in the app.
   Problems: whatever goes wrong on a phone (an error in the page, a promise nobody caught, an error
   the app writes to its log, a server error answer) is reported quietly to Rozha's Admin, with the
   phone, the app version and the screen it happened on. Each problem is kept on this phone first (at
   most 20, the same one only once with a count) and sent when the phone is signed in and online, so
   errors at start-up or offline still arrive. People can also write one themselves: Settings, Report a
   Problem. Nothing personal is sent: no PIN, no order contents, only the error's own text.
   Time in the app: seconds while the app is on the screen and someone used it in the last 5 minutes,
   kept on this phone until the next heartbeat sends them (app.js heartbeat). The server adds them up
   per person and phone, every day, and never resets them.
   Loads right after storage.js, so it catches problems from the first moment. Depends on (runtime
   only): api, apiSession, lget, lset, APP_VERSION, and state when app.js has loaded. */

const PROBLEM_KEY = 'problemQueue';
const PROBLEM_KINDS = ['error', 'rejection', 'console', 'server', 'manual'];
let problemTimer = 0, problemSending = false, problemReporting = false;
/* A short, stable name for a problem: the same error on any phone gets the same one (numbers in the
   message, like ids and line numbers, don't make it a different problem). */
function problemFingerprint(kind, message, source){
  const text = [kind, String(message).replace(/\d+/g, '#').slice(0, 300), String(source || '').replace(/[?#].*$/, '').replace(/:\d+(:\d+)?$/, '')].join('|');
  let a = 0x811c9dc5, b = 0x9dc5811c;
  for(let i = 0; i < text.length; i++){
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 ^ 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
const currentScreen = ()=>{ try{ return typeof state === 'object' && state?.view && /^[A-Za-z]{1,40}$/.test(state.view) ? state.view : null; }catch(_){ return null; } };
function reportProblem(kind, message, {source = '', stack = ''} = {}){
  if(problemReporting || !PROBLEM_KINDS.includes(kind)) return;
  problemReporting = true;
  try{
    const text = String(message ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if(!text) return;
    const fingerprint = problemFingerprint(kind, text, source);
    const queue = (lget(PROBLEM_KEY) || []).filter(p=>p && /^[0-9a-f]{16,64}$/.test(p.fingerprint));
    const same = queue.find(p=>p.fingerprint === fingerprint);
    if(same) same.count = Math.min(1000, (same.count || 1) + 1);
    else queue.push({fingerprint, kind, message:text, source:String(source || '').slice(0, 200), stack:String(stack || '').slice(0, 2000), screen:currentScreen(), count:1});
    lset(PROBLEM_KEY, queue.slice(-20));
    clearTimeout(problemTimer);
    problemTimer = setTimeout(flushProblems, kind === 'manual' ? 0 : 4000);
  }catch(_){ /* reporting a problem must never cause one */ }
  finally{ problemReporting = false; }
}
/* Sends what is waiting (10 at a time). Returns true when nothing is left. */
async function flushProblems(){
  if(problemSending || !apiSession() || !navigator.onLine) return false;
  const queue = lget(PROBLEM_KEY) || [];
  if(!queue.length) return true;
  problemSending = true;
  try{
    const batch = queue.slice(0, 10);
    const r = await api('problems', {method:'POST', body:{reports:batch.map(p=>({fingerprint:p.fingerprint, kind:p.kind, message:p.message, source:p.source || undefined, stack:p.stack || undefined, screen:p.screen || undefined, count:p.count || 1}))}});
    if(r.ok || r.status === 400){
      // Sent (or refused as malformed, which would never change): take exactly those off the list.
      const sent = new Set(batch.map(p=>p.fingerprint));
      lset(PROBLEM_KEY, (lget(PROBLEM_KEY) || []).filter(p=>!sent.has(p.fingerprint)));
      if((lget(PROBLEM_KEY) || []).length) problemTimer = setTimeout(flushProblems, 1000);
      return true;
    }
    return false;
  }finally{ problemSending = false; }
}
(function catchProblems(){
  const ours = file=>!file || file.startsWith(location.origin) || file.startsWith('blob:' + location.origin);
  const noise = msg=>/^Script error\.?$|ResizeObserver loop|AbortError|The operation was aborted|Load failed$|NetworkError when attempting to fetch|Failed to fetch/i.test(String(msg || ''));
  window.addEventListener('error', e=>{
    if(!e.message || noise(e.message) || !ours(e.filename)) return;
    const file = String(e.filename || '').split('/').pop();
    reportProblem('error', e.message, {source:file ? `${file}:${e.lineno || 0}:${e.colno || 0}` : '', stack:e.error?.stack || ''});
  });
  window.addEventListener('unhandledrejection', e=>{
    const why = e.reason;
    const message = why instanceof Error ? `${why.name}: ${why.message}` : typeof why === 'string' ? why : '';
    if(!message || noise(message) || why?.name === 'AbortError') return;
    reportProblem('rejection', message, {stack:why?.stack || ''});
  });
  // What the app itself writes to its log as an error is reported too (it still reaches the log).
  const log = console.error.bind(console);
  console.error = (...args)=>{
    log(...args);
    const err = args.find(a=>a instanceof Error);
    const message = args.map(a=>a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : (()=>{ try{ return JSON.stringify(a); }catch(_){ return String(a); } })()).join(' ');
    if(!noise(message) && !noise(err?.message)) reportProblem('console', message, {stack:err?.stack || ''});
  };
  window.addEventListener('online', ()=>{ clearTimeout(problemTimer); problemTimer = setTimeout(flushProblems, 2000); });
})();

/* ---------- Time in the app ---------- */
const USAGE_IDLE_MS = 5 * 60 * 1000;
let usageLastTick = performance.now(), usageLastUse = Date.now();
const usageKey = ()=>{ const s = apiSession(); return s && (s.account === 'rozha' || s.account === 'yunis') ? 'usagePending:' + s.account : null; };
function usageCount(){
  const now = performance.now(), passed = Math.min(30000, now - usageLastTick);
  usageLastTick = now;
  const key = usageKey();
  if(!key || document.visibilityState !== 'visible' || Date.now() - usageLastUse > USAGE_IDLE_MS) return;
  lset(key, Math.min(86400, (Number(lget(key)) || 0) + passed / 1000));
}
/* Seconds waiting to be sent, taken off this phone (heartbeat puts them back if the send fails). */
function takeUsage(){
  usageCount();
  const key = usageKey();
  if(!key) return 0;
  const seconds = Math.min(1800, Math.floor(Number(lget(key)) || 0));
  if(seconds < 1) return 0;
  lset(key, (Number(lget(key)) || 0) - seconds);
  return seconds;
}
function returnUsage(seconds){
  const key = usageKey();
  if(key && seconds > 0) lset(key, Math.min(86400, (Number(lget(key)) || 0) + seconds));
}
['pointerdown', 'keydown', 'wheel', 'touchmove'].forEach(type=>document.addEventListener(type, ()=>{ usageLastUse = Date.now(); }, {passive:true, capture:true}));
document.addEventListener('scroll', ()=>{ usageLastUse = Date.now(); }, {passive:true, capture:true});
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible'){ usageLastTick = performance.now(); usageLastUse = Date.now(); return; }
  usageCount();
  // Leaving the app: send what was counted now (the request finishes even as the page goes away).
  const seconds = takeUsage();
  if(seconds) api('devices/me', {method:'POST', body:{seconds}, keepalive:true}).then(r=>{ if(!r.ok) returnUsage(seconds); });
});
setInterval(usageCount, 15000);
