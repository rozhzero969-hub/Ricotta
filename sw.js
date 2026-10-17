/* Cache only this build's immutable public assets. HTML, config, credentials,
   API requests and business data always use the network. Push remains active. */
const STATIC_CACHE = 'ricotta-static-dev';
const STATIC_FILES = [];
const assetUrls = new Set(STATIC_FILES.map(file=>new URL(file,self.registration.scope).href));
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async()=>{
  for(const key of await caches.keys()) if(key.startsWith('ricotta-static-') && key !== STATIC_CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request=event.request;
  if(request.method !== 'GET' || !assetUrls.has(request.url)) return;
  event.respondWith((async()=>{
    const cache=await caches.open(STATIC_CACHE), hit=await cache.match(request);
    if(hit) return hit;
    const response=await fetch(request);
    if(response.ok && response.type === 'basic') {
      // Best effort: full/private storage must never turn a valid response into a failure.
      event.waitUntil(cache.put(request,response.clone()).catch(()=>{}));
    }
    return response;
  })());
});

/* iOS requires every push to show a visible notification, so we always
   show one -- even if the app happens to be open, and even if something is
   odd about the payload (a push that shows nothing can get the subscription
   revoked). */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : '' }; }

  const kind = data.kind || 'general';   /* 'update' | 'reminder' | 'supplier' | 'assistant' | 'note' | 'general' */
  /* Rico's own messages carry his mood and show his face for it, not the app icon. */
  const RICO_MOODS = ['happy', 'excited', 'grateful', 'calm', 'thinking', 'worried', 'sad', 'angry'];
  const icon = kind === 'assistant' ? 'rico-' + (RICO_MOODS.includes(data.mood) ? data.mood : 'happy') + '.png' : 'icon-192.png';
  const title = data.title || 'Ricotta Orders';
  const supplierId = data.supplierId || '';
  /* Some of Rico's messages belong to a screen: 'history' (save the month) or 'notes' (an unread note). */
  const view = data.view === 'history' || data.view === 'notes' ? data.view : '';

  event.waitUntil((async () => {
    try {
      await self.registration.showNotification(title, {
        body: data.body || '',
        tag: data.tag || ('ricotta-' + kind),   /* one notification per supplier, not one shared pile */
        renotify: true,                          /* a newer one with the same tag still alerts */
        icon,
        data: { kind, supplierId, view, body: data.body || '' }
      });
    } catch (e) {
      await self.registration.showNotification(title, { body: data.body || '', data: { kind, supplierId, view, body: data.body || '' } });
    }
    /* The red number on the app icon: a note, an answer, or one of Rico's warnings adds one while the
       app is closed. The app sets the exact number again whenever it is opened. */
    if ((kind === 'note' || kind === 'assistant') && self.navigator && self.navigator.setAppBadge) {
      try {
        const cache = await caches.open('ricotta-badge');
        const prev = Number(await (await cache.match('/badge'))?.text() || 0);
        await cache.put('/badge', new Response(String(prev + 1)));
        await self.navigator.setAppBadge(prev + 1);
      } catch (e) { /* the badge is a nice-to-have */ }
    }
    /* If the app is open right now, show the update message straight away. */
    if (kind === 'update') {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      wins.forEach(w => w.postMessage({ kind, body: data.body || '' }));
    }
  })());
});

/* Tapping a notification: focus the app if it's open, otherwise launch it.
   Either way the app is told what the notification was about (for a
   supplier reminder, which supplier; for an update, its message; for some
   of Rico's messages, which screen). */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const d = event.notification.data || {};
  const kind = d.kind || 'general';
  const supplierId = d.supplierId || '';
  const view = d.view || '';
  const body = kind === 'update' ? String(d.body || '').slice(0, 300) : '';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      const w = wins.find(x => x.visibilityState === 'visible') || wins[0];
      try { await w.focus(); } catch (e) {}
      w.postMessage({ kind, supplierId, view, body });
      return;
    }
    let url = self.registration.scope + '?n=' + encodeURIComponent(kind);
    if (supplierId) url += '&s=' + encodeURIComponent(supplierId);
    if (view) url += '&v=' + encodeURIComponent(view);
    if (body) url += '&m=' + encodeURIComponent(body);
    await self.clients.openWindow(url);
  })());
});
