// Legacy custom service worker shim.
// The app no longer registers `/sw.js`, but older browsers may still have a stale registration.
// Keep a top-level `message` handler so those workers upgrade cleanly without Chromium warnings.

self.addEventListener("message", () => {});

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
