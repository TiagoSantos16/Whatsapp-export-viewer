/* Chat Archive legacy shell transition v1. Only existing registrations request this file. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  // Retire this registration only. Keep every database and cache intact.
  event.waitUntil(self.registration.unregister());
});
