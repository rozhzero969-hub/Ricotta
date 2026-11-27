/* Cache only this build's immutable public assets, and a copy of the app's own page that opens them.
   Config, credentials, API requests and business data always use the network (the app keeps its own
   offline copies of the data in IndexedDB, per account). Push remains active.
   Opening the app always asks for the newest page: an older copy could point at files a newer update has
   already replaced, and the app would then stay on its loading screen. Offline, the copy the browser kept
   is used, or else the copy kept here: kept only when every file it names is one of this build's (so it
   always opens), and replaced with each version. Installing a version keeps its files at once, so the
   app opens offline right after an update too. */
const STATIC_CACHE = 'ricotta-static-dev';
const STATIC_FILES = [];
const assetUrls = new Set(STATIC_FILES.map(file=>new URL(file,self.registration.scope).href));
const PAGE_KEY = self.registration.scope;
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(precache());
});
/* Best effort: a file that can't be fetched now is fetched the first time it is used. The spreadsheet
   library (only for exports) is left for then. Hashed URLs can use the browser's cache unchanged. */
async function precache(){
  if(!STATIC_FILES.length) return;
  try{
    const cache=await caches.open(STATIC_CACHE);
    await Promise.all([...assetUrls].filter(u=>!/\/assets\/spreadsheet\./.test(u)).map(async u=>{
      try{ if(!(await cache.match(u))){ const r=await fetch(u,{cache:'force-cache'}); if(r.ok && r.type==='basic') await cache.put(u,r); } }catch(_){}
    }));
    await keepPage(cache, await fetch(PAGE_KEY,{cache:'no-cache',credentials:'same-origin'}));
  }catch(_){ /* full or private storage: the app still opens online */ }
}
const isAppPage = url=>{ const u=new URL(url), s=new URL(PAGE_KEY); return u.origin===s.origin && (u.pathname===s.pathname || u.pathname===s.pathname+'index.html'); };
/* The page is kept only when it opens with this build's files (every assets/ file it names is here). */
async function keepPage(cache, response){
  try{
    if(!STATIC_FILES.length || !response || !response.ok || response.redirected || response.type!=='basic') return;
    const html=await response.clone().text();
    const named=[...html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)].map(m=>new URL(m[1],self.registration.scope).href);
    if(!named.length || !named.every(u=>assetUrls.has(u))) return;
    await cache.put(PAGE_KEY,response);
  }catch(_){ /* best effort */ }
}
self.addEventListener('activate', event => event.waitUntil((async()=>{
  try{
    for(const key of await caches.keys()) if(key.startsWith('ricotta-static-') && key !== STATIC_CACHE) await caches.delete(key);
  }catch(_){ /* unavailable/full cache storage cannot prevent worker activation */ }
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request=event.request;
  if(request.method === 'GET' && request.mode === 'navigate' && request.url.startsWith(self.registration.scope)){
    event.respondWith(openPage(request.url, event));
    return;
  }
  if(request.method !== 'GET' || !assetUrls.has(request.url)) return;
  event.respondWith((async()=>{
    let cache;
    try{
      cache=await caches.open(STATIC_CACHE);
      const hit=await cache.match(request);
      if(hit) return hit;
    }catch(_){cache=null;}
    // Private browsing/storage failures are a network-only visit, never a broken script.
    const response=await fetch(request);
    if(cache && response.ok && response.type === 'basic') {
      // Best effort: full/private storage must never turn a valid response into a failure.
      event.waitUntil(cache.put(request,response.clone()).catch(()=>{}));
    }
    return response;
  })());
});

/* The page, checked with the server every time (a quick "not modified" when nothing changed). With no
   connection: the browser's own copy, else the copy kept above. */
async function openPage(url, event){
  let response;
  try{
    response=await fetch(url,{cache:'no-cache',credentials:'same-origin'});
    if(isAppPage(url) && STATIC_FILES.length && response.ok && response.type==='basic' && !response.redirected){
      const copy=response.clone();
      event?.waitUntil(caches.open(STATIC_CACHE).then(cache=>keepPage(cache,copy)).catch(()=>{}));
    }
  }
  catch(_){
    try{ response=await fetch(url,{cache:'force-cache',credentials:'same-origin'}); }
    catch(e){
      let kept=null;
      try{ kept=isAppPage(url) ? await (await caches.open(STATIC_CACHE)).match(PAGE_KEY) : null; }catch(_){ kept=null; }
      if(kept) return kept;
      throw e;
    }
  }
  // A page that moved is opened at its new address (a navigation cannot take a followed redirect).
  return response.redirected ? Response.redirect(response.url, 302) : response;
}

/* iOS requires every push to show a visible notification, so we always
   show one -- even if the app happens to be open, and even if something is
   odd about the payload (a push that shows nothing can get the subscription
   revoked). */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : '' }; }

  if(!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  const kind = data.kind || 'general';   /* 'reminder' | 'supplier' | 'assistant' | 'security' | 'general' */
  const icon = 'icon-192.png';
  const title = data.title || 'Ricotta Orders';
  const supplierId = data.supplierId || '';
  /* Some messages belong to a screen: 'history' (save the month), 'admin' (a new device signed in). */
  const view = data.view === 'history' || data.view === 'admin' ? data.view : '';

  event.waitUntil((async () => {
    try {
      await self.registration.showNotification(title, {
        body: data.body || '',
        tag: data.tag || ('ricotta-' + kind),   /* one notification per supplier, not one shared pile */
        renotify: true,                          /* a newer one with the same tag still alerts */
        icon,
        /* Buttons on the notification appear where the phone supports them; on an iPhone, a tap does the same. */
        actions: data.actionTitle ? [{ action: 'prepare', title: String(data.actionTitle).slice(0, 40) }] : [],
        data: { kind, supplierId, view }
      });
    } catch (e) {
      await self.registration.showNotification(title, { body: data.body || '', data: { kind, supplierId, view } });
    }
    /* The red number on the app icon: one of Rico's warnings adds one while the app is closed.
       The app sets the exact number again whenever it is opened. */
    if (kind === 'assistant' && self.navigator && self.navigator.setAppBadge) {
      try {
        const cache = await caches.open('ricotta-badge');
        const prev = Number(await (await cache.match('/badge'))?.text() || 0);
        await cache.put('/badge', new Response(String(prev + 1)));
        await self.navigator.setAppBadge(prev + 1);
      } catch (e) { /* the badge is a nice-to-have */ }
    }
  })());
});

/* Tapping a notification: focus the app if it's open, otherwise launch it.
   Either way the app is told what the notification was about (for a
   supplier reminder, which supplier; for some messages, which screen). */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const d = event.notification.data || {};
  const kind = d.kind || 'general';
  const supplierId = d.supplierId || '';
  const view = d.view || '';
  event.waitUntil((async () => {
    const wins = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(w => isAppPage(w.url));
    if (wins.length) {
      const w = wins.find(x => x.visibilityState === 'visible') || wins[0];
      try { await w.focus(); } catch (e) {}
      w.postMessage({ kind, supplierId, view });
      return;
    }
    let url = self.registration.scope + '?n=' + encodeURIComponent(kind);
    if (supplierId) url += '&s=' + encodeURIComponent(supplierId);
    if (view) url += '&v=' + encodeURIComponent(view);
    await self.clients.openWindow(url);
  })());
});
