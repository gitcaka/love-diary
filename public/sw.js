const CACHE_VERSION = "love-diary-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const MEDIA_CACHE = "love-diary-media-v1";
const AUDIO_CACHE = "love-diary-audio-v1";
const SHELL_FILES = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => Promise.allSettled(SHELL_FILES.map((file) => cache.add(file)))));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CLEAR_MEDIA_CACHE") event.waitUntil(Promise.all([caches.delete(MEDIA_CACHE), caches.delete(AUDIO_CACHE)]));
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, MEDIA_CACHE, AUDIO_CACHE]);
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("love-diary-") && !keep.has(key)).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

async function trimCache(cache, maximum) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maximum)).map((key) => cache.delete(key)));
}

async function cacheFirst(request, cacheName, maximum = 80) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type !== "opaque") {
    try {
      await cache.put(request, response.clone());
      await trimCache(cache, maximum);
    } catch {
      // A full device cache must never prevent the network response from being shown.
    }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // State requests stay network-authoritative; the app already falls back to its local IndexedDB copy.
  if (url.pathname.startsWith("/api/")) return;

  // Let cross-origin media use the browser's HTTP cache instead of storing opaque responses.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/media/")) {
    event.respondWith(cacheFirst(request, MEDIA_CACHE, 50));
    return;
  }

  if (request.destination === "audio" || url.pathname === "/bg.wav") {
    event.respondWith(cacheFirst(request, AUDIO_CACHE, 2));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) await (await caches.open(SHELL_CACHE)).put("/", response.clone()).catch(() => undefined);
      return response;
    }).catch(() => caches.match("/")));
    return;
  }

  if (["script", "style", "image", "font"].includes(request.destination)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE, 80));
  }
});
