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

  const kind = data.kind || 'general';   /* 'update' | 'reminder' | 'supplier' | 'assistant' | 'overdue' | 'general' */
  /* Rico's own messages carry his mood and show his face for it, not the app icon. */
  const RICO_MOODS = ['happy', 'excited', 'grateful', 'calm', 'thinking', 'worried', 'sad', 'angry'];
  const icon = kind === 'assistant' ? 'rico-' + (RICO_MOODS.includes(data.mood) ? data.mood : 'happy') + '.png' : 'icon-192.png';
  const title = data.title || 'Ricotta Orders';
  const supplierId = data.supplierId || '';

  event.waitUntil((async () => {
    try {
      await self.registration.showNotification(title, {
        body: data.body || '',
        tag: data.tag || ('ricotta-' + kind),   /* one notification per supplier, not one shared pile */
        renotify: true,                          /* a newer one with the same tag still alerts */
        icon,
        data: { kind, supplierId, body: data.body || '' }
      });
    } catch (e) {
      await self.registration.showNotification(title, { body: data.body || '', data: { kind, supplierId, body: data.body || '' } });
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
   supplier reminder, which supplier; for an update, its message). */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const d = event.notification.data || {};
  const kind = d.kind || 'general';
  const supplierId = d.supplierId || '';
  const body = kind === 'update' ? String(d.body || '').slice(0, 300) : '';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      const w = wins.find(x => x.visibilityState === 'visible') || wins[0];
      try { await w.focus(); } catch (e) {}
      w.postMessage({ kind, supplierId, body });
      return;
    }
    let url = self.registration.scope + '?n=' + encodeURIComponent(kind);
    if (supplierId) url += '&s=' + encodeURIComponent(supplierId);
    if (body) url += '&m=' + encodeURIComponent(body);
    await self.clients.openWindow(url);
  })());
});
