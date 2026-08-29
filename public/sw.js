// The Wanderers' Map — service worker.
// Deliberately minimal: this is a LIVE app (positions, messages), so we must
// never serve stale data. Strategy: network-first for everything, with a tiny
// cache only as an offline fallback for the app shell. No caching of API calls.

const SHELL = 'wm-shell-v1';
const SHELL_FILES = ['/', '/index.html', '/app.js', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES).catch(() => {})));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return; // never touch POSTs (updates, messages)
  const url = new URL(req.url);
  // never cache live endpoints — always go to network
  if (/^\/(positions|stream|trip|profile|msg|places|group)/.test(url.pathname)) return;

  // network-first; fall back to cache only if offline
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(SHELL).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
  );
});
