/* Push only: deliberately no fetch handler or offline cache. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function safePath(path) {
  return typeof path === "string" &&
    /^\/(weeks\/[a-f0-9-]{36}|leagues\/[a-f0-9-]{36}\/messages\/[a-f0-9-]{36})$/.test(path)
    ? path
    : "/";
}

self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    /* A visible fallback is required even for malformed messages. */
  }
  event.waitUntil(
    self.registration.showNotification(
      typeof payload?.title === "string" ? payload.title.slice(0, 100) : "POW Pick'em",
      {
        body:
          typeof payload?.body === "string" ? payload.body.slice(0, 200) : "Open POW Pick'em for an update.",
        icon: "/icon-192.png",
        tag: typeof payload?.tag === "string" ? payload.tag : "pow-update",
        data: { url: safePath(payload?.url) },
      },
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(safePath(event.notification.data?.url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Only focus an existing window already on this destination; never navigate away from unsaved picks.
      const existing = windows.find((client) => client.url === url);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })(),
  );
});
