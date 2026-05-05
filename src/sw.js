// Polkupp custom service worker
// Bruker injectManifest-strategi i vite-plugin-pwa: workbox precache injektes
// her, og vi legger til custom push-event-handler.

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Cache Vinmonopolets bilde-CDN aggressivt
registerRoute(
  ({ url }) => url.hostname === "bilder.vinmonopolet.no",
  new CacheFirst({
    cacheName: "vmp-product-images",
    plugins: [new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 30 * 24 * 3600 })],
  })
);

// /api/stock — kort cache, network-first
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/stock"),
  new NetworkFirst({
    cacheName: "stock-api",
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 600 })],
  })
);

// ----- Push-handler -----

self.addEventListener("push", (event) => {
  let payload = { title: "Polkupp", body: "Nye prisnedsettelser tilgjengelig" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch { /* ikke-JSON payload */ }

  const options = {
    body: payload.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag ?? "polkupp-drops",
    renotify: true,
    data: { url: payload.url ?? "/" },
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.endsWith(targetUrl) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ----- Auto-update flow -----
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
