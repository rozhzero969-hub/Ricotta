/* Ricotta Orders -- service worker. PUSH ONLY.
   It deliberately has no fetch handler and caches nothing, so it can never
   serve an old copy of the app and the update checker / hardReload() in
   update-check.js keep working exactly as before. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* iOS requires every push to show a visible notification, so we always
   show one -- even if the app happens to be open. */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : '' }; }

  const kind = data.kind || 'general';   /* 'update' | 'reminder' | 'general' */
  const title = data.title || 'Ricotta Orders';

  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || ('ricotta-' + kind),
      icon: 'icon-192.png',
      data: { kind }
    });
    /* If the app is open right now, show the What's new popup straight away. */
    if (kind === 'update') {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      wins.forEach(w => w.postMessage({ kind }));
    }
  })());
});

/* Tapping a notification: focus the app if it's open, otherwise launch it.
   Either way the app is told what the notification was about. */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const kind = (event.notification.data && event.notification.data.kind) || 'general';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      const w = wins[0];
      try { await w.focus(); } catch (e) {}
      w.postMessage({ kind });
      return;
    }
    await self.clients.openWindow(self.registration.scope + '?n=' + encodeURIComponent(kind));
  })());
});
