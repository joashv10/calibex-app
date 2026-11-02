// CALIBEX service worker — Web Push reminders.
// It only handles push, so a new version can take over at once.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = data.title || "CALIBEX";
  const body = data.body || "Time to log.";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "calibex-nudge",
      data: { url: data.url || "/" },
      vibrate: [60, 40, 60],
    })
  );
});

// Open the reminder's exact sheet. If the app is already running, focus it and hand
// it the URL (no reload, no splash); if it doesn't answer within 1.5 s (suspended,
// or an old build without the listener), navigate it there instead. Cold start
// opens a window at the URL.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const c = cs.find((w) => w.url.startsWith(self.location.origin));
    if (!c) return self.clients.openWindow(url);
    try { await c.focus(); } catch (_) {}
    const acked = await new Promise((resolve) => {
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(false), 1500);
      ch.port1.onmessage = () => { clearTimeout(t); resolve(true); };
      c.postMessage({ type: "calibex:open", url }, [ch.port2]);
    });
    if (!acked && "navigate" in c) {
      try { await c.navigate(url); } catch (_) { return self.clients.openWindow(url); }
    }
  })());
});
