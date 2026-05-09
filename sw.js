const C = 'finai-v7';
const PRECACHE = ['/', '/index.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(C).then(cache => cache.addAll(PRECACHE).catch(() => {}))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;

  // API calls: network-first, return structured JSON error when offline
  if (url.includes('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(
          JSON.stringify({ error: { code: 'offline', message: 'No internet connection. Please check your network.' } }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // External requests: pass through without caching
  if (!url.startsWith(self.location.origin)) return;
  if (url.includes('googleapis.com') || url.includes('youtube.com') || url.includes('ytimg.com')) return;

  // Same-origin static assets: cache-first with network fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(C).then(cache => cache.put(e.request, clone));
        }
        return resp;
      }).catch(() =>
        new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
      );
    })
  );
});

self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : { title: 'FinAI', body: 'Market update ready.' };
  e.waitUntil(self.registration.showNotification(d.title || 'FinAI', {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: d.tag || 'finai',
    renotify: true,
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(l => l.length ? l[0].focus() : clients.openWindow('/'))
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SCHED') {
    const { delay: d, title: t, body: b, tag: g } = e.data;
    setTimeout(() => {
      self.registration.showNotification(t, {
        body: b, icon: '/icons/icon-192.png', tag: g || 'sched', renotify: true,
      });
    }, d);
  }
});
