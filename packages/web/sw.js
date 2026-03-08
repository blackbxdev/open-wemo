/**
 * Open Wemo Service Worker
 *
 * Strategy: Network-only (no caching)
 * All requests go directly to the network to ensure fresh content.
 * The service worker is kept for PWA installability requirements.
 */

// Install event - skip waiting immediately, no caching
self.addEventListener("install", (event) => {
  console.log("[SW] Installing service worker (no-cache mode)...");

  // Clear any existing caches from previous versions
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            console.log("[SW] Deleting old cache:", name);
            return caches.delete(name);
          })
        );
      })
      .then(() => {
        console.log("[SW] All caches cleared");
        return self.skipWaiting();
      })
  );
});

// Activate event - take control immediately
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating service worker...");

  event.waitUntil(
    // Clear any caches that might have been created
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(cacheNames.map((name) => caches.delete(name)));
      })
      .then(() => {
        console.log("[SW] Service worker activated (no-cache mode)");
        return self.clients.claim();
      })
  );
});

// Fetch event - always go to network, no caching
self.addEventListener("fetch", (_event) => {
  // Let all requests pass through to the network
  // Don't intercept - just let the browser handle it normally
  return;
});

// Handle messages from the main app
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
});
