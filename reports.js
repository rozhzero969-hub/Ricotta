/* Ricotta Orders -- problem reports and time in the app.
   Problems: whatever goes wrong on a phone (an error in the page, a promise nobody caught, an error
   the app writes to its log, a server error answer) is reported quietly to Rozha's Admin, with the
   phone, the app version and the screen it happened on. Each problem is kept on this phone first (at
   most 20, the same one only once with a count) and sent when the phone is signed in and online, so
   errors at start-up or offline still arrive. People can also write one themselves: Settings, Report a
   Problem. Each problem keeps who was signed in when it happened (or "before sign-in"), so it is sent
   under that account only. Before anything is kept, PINs, tokens, keys, long numbers and web addresses'
   details are taken out of the text (redactProblem; the server does it again).
   Time in the app: seconds while the app is on the screen and someone used it in the last 5 minutes,
   kept on this phone until the next heartbeat sends them (app.js heartbeat). The server adds them up
   per person and phone, every day, and never resets them.
   Loads right after storage.js, so it catches problems from the first moment. Depends on (runtime
   only): api, apiSession, lget, lset, APP_VERSION, and state when app.js has loaded. */

const PROBLEM_KEY = 'problemQueue';
/* What must never be kept or sent: PIN-like 6-digit numbers, phone and other long numbers, keys and
   tokens, and the details after "?" or "#" in a web address. */
function redactProblem(text){
  return String(text ?? '')
    .replace(/\b(?:sk-ant|sk|gsk|EAA|AIza)[\w-]{8,}/g, '[key]')
    .replace(/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer [token]')
    .replace(/\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{32,}\b/g, '[token]')   // long mixed letters and digits
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s)]*/g, '$1')
    .replace(/\+?\d[\d ]{6,}\d/g, '[number]')
    .replace(/\b\d{6}\b/g, '[pin]');
}
const signedInAccount = ()=>{ const s = apiSession(); return s && (s.account === 'rozha' || s.account === 'yunis') ? s.account : null; };
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
const currentScreen = ()=>{ try{ return typeof state === 'object' && state?.account && state?.view && /^[A-Za-z]{1,40}$/.test(state.view) ? state.view : 'signin'; }catch(_){ return null; } };
function reportProblem(kind, message, {source = '', stack = ''} = {}){
  if(problemReporting || !PROBLEM_KINDS.includes(kind)) return;
  problemReporting = true;
  try{
    const text = redactProblem(String(message ?? '').replace(/\s+/g, ' ').trim()).slice(0, 500);
    if(!text) return;
    const fingerprint = problemFingerprint(kind, text, source), account = signedInAccount();
    const queue = (lget(PROBLEM_KEY) || []).filter(p=>p && /^[0-9a-f]{16,64}$/.test(p.fingerprint));
    const same = queue.find(p=>p.fingerprint === fingerprint && (p.account || null) === account);
    if(same) same.count = Math.min(1000, (same.count || 1) + 1);
    else queue.push({fingerprint, account, kind, message:text, source:redactProblem(source).slice(0, 200), stack:redactProblem(stack).slice(0, 2000), screen:currentScreen(), count:1});
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
    // Only this account's problems, and those from before anyone signed in on this phone.
    const me = signedInAccount();
    const batch = queue.filter(p=>!p.account || p.account === me).slice(0, 10);
    if(!batch.length) return true;
    const r = await api('problems', {method:'POST', body:{reports:batch.map(p=>({fingerprint:p.fingerprint, kind:p.kind, message:p.message, source:p.source || undefined, stack:p.stack || undefined, screen:p.screen || undefined, count:p.count || 1}))}});
    if(r.ok || r.status === 400){
      // Sent (or refused as malformed, which would never change): take off exactly what was sent. The same
      // problem happening again while this was on its way stays, with the new count.
      const left = (lget(PROBLEM_KEY) || []).map(p=>{
        const sent = batch.find(b=>b.fingerprint === p.fingerprint && (b.account || null) === (p.account || null));
        return sent ? {...p, count:(p.count || 1) - (sent.count || 1)} : p;
      }).filter(p=>p.count > 0);
      lset(PROBLEM_KEY, left);
      if(left.some(p=>!p.account || p.account === me)) problemTimer = setTimeout(flushProblems, 1000);
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
    // Only text and errors are kept: objects are named by their kind, never written out (they can hold anything).
    const message = args.map(a=>a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : typeof a === 'number' || typeof a === 'boolean' ? String(a) : `[${a?.constructor?.name || typeof a}]`).join(' ');
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
/* Seconds to send: one batch at a time, kept under the account that counted it with its own id until the
   server confirms it. A failed send is retried with the same id (the server counts an id once), and a batch
   never moves to whoever signs in next. Returns {id, seconds, account} or null. */
const usageOutboxKey = account=>'usageOutbox:' + account;
function takeUsage(){
  usageCount();
  const key = usageKey(), account = signedInAccount();
  if(!key || !account) return null;
  let batch = lget(usageOutboxKey(account));
  if(!batch?.id){
    const seconds = Math.min(1800, Math.floor(Number(lget(key)) || 0));
    if(seconds < 1) return null;
    batch = {id:crypto.randomUUID(), seconds};
    lset(key, (Number(lget(key)) || 0) - seconds);
    lset(usageOutboxKey(account), batch);
  }
  return {...batch, account};
}
/* The server answered: a counted batch (or one it refused as malformed) is done; otherwise it waits. */
function settleUsage(batch, r){
  if(!batch || !(r.ok || r.status === 400)) return;
  if(lget(usageOutboxKey(batch.account))?.id === batch.id) lset(usageOutboxKey(batch.account), null);
}
const usageBody = batch=>batch ? {seconds:batch.seconds, batch:batch.id} : {};
['pointerdown', 'keydown', 'wheel', 'touchmove'].forEach(type=>document.addEventListener(type, ()=>{ usageLastUse = Date.now(); }, {passive:true, capture:true}));
document.addEventListener('scroll', ()=>{ usageLastUse = Date.now(); }, {passive:true, capture:true});
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible'){ usageLastTick = performance.now(); usageLastUse = Date.now(); return; }
  usageCount();
  // Leaving the app: send what was counted now (the request finishes even as the page goes away).
  const batch = takeUsage();
  if(batch) api('devices/me', {method:'POST', body:usageBody(batch), keepalive:true}).then(r=>settleUsage(batch, r));
});
setInterval(usageCount, 15000);
