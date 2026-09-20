/* Ricotta Orders -- service worker. PUSH ONLY.
   It deliberately has no fetch handler and caches nothing, so it can never
   serve an old copy of the app and the update checker / hardReload() in
   update-check.js keep working exactly as before. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* iOS requires every push to show a visible notification, so we always
   show one -- even if the app happens to be open, and even if something is
   odd about the payload (a push that shows nothing can get the subscription
   revoked). */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : '' }; }

  const kind = data.kind || 'general';   /* 'update' | 'reminder' | 'supplier' | 'general' */
  const title = data.title || 'Ricotta Orders';
  const supplierId = data.supplierId || '';

  event.waitUntil((async () => {
    try {
      await self.registration.showNotification(title, {
        body: data.body || '',
        tag: data.tag || ('ricotta-' + kind),   /* one notification per supplier, not one shared pile */
        renotify: true,                          /* a newer one with the same tag still alerts */
        icon: 'icon-192.png',
        data: { kind, supplierId }
      });
    } catch (e) {
      await self.registration.showNotification(title, { body: data.body || '', data: { kind, supplierId } });
    }
    /* If the app is open right now, show the What's new popup straight away. */
    if (kind === 'update') {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      wins.forEach(w => w.postMessage({ kind }));
    }
  })());
});

/* Tapping a notification: focus the app if it's open, otherwise launch it.
   Either way the app is told what the notification was about (and, for a
   supplier reminder, which supplier). */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const d = event.notification.data || {};
  const kind = d.kind || 'general';
  const supplierId = d.supplierId || '';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      const w = wins.find(x => x.visibilityState === 'visible') || wins[0];
      try { await w.focus(); } catch (e) {}
      w.postMessage({ kind, supplierId });
      return;
    }
    let url = self.registration.scope + '?n=' + encodeURIComponent(kind);
    if (supplierId) url += '&s=' + encodeURIComponent(supplierId);
    await self.clients.openWindow(url);
  })());
});
