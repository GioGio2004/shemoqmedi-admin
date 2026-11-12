// Service worker for the Studio and admin PWAs (one file, both hosts).
//
// It only does push: shows the notifications convex/push.ts sends and opens
// their link on tap. No fetch handler and no caches, on purpose: the admin is
// live data behind a session, and a stale cached page would be worse than
// none. Served with no-cache headers (next.config.ts) so updates land at once.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** The push payload: { title, body, url, tag? } (convex/lib/push.ts payloadFor). */
function readPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { body: event.data.text() };
  }
}

self.addEventListener("push", (event) => {
  const data = readPayload(event);
  const options = {
    body: data.body || "",
    icon: "/icons/crow-192.png",
    badge: "/icons/crow-badge-96.png",
    data: { url: data.url || "/" },
  };
  // A tag replaces an older notification about the same thing; renotify
  // still buzzes for the update.
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(data.title || "Shemoqmedi", options));
});

/** Focus a window already showing the link, else reuse one of this app's windows, else open one. */
async function openLink(href) {
  const target = new URL(href, self.location.origin);
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

  const exact = windows.find((w) => w.url === target.href);
  if (exact) return exact.focus();

  if (target.origin === self.location.origin) {
    const own = windows.find((w) => new URL(w.url).origin === target.origin);
    if (own && "navigate" in own) {
      try {
        const navigated = await own.navigate(target.href);
        if (navigated) return navigated.focus();
      } catch {
        // An uncontrolled window can't be navigated from here: open a new one.
      }
    }
  }
  return self.clients.openWindow(target.href);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openLink((event.notification.data && event.notification.data.url) || "/"));
});
