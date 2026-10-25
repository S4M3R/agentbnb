// AgentBnB's service worker: Web Push only (no offline caching).
// Push payload, from src/lib/notify.ts: { id, title, body, url, tag }.
// Served from /public with `Cache-Control: max-age=0` and registered with `updateViaCache: "none"`,
// so browsers check for a new version on every navigation.

const ICON = "/app-icons/icon-192.png";
// White Couchbot on transparent: Android draws the status-bar badge from its alpha only.
const BADGE = "/app-icons/badge-96.png";
const DEFAULT_URL = "/me/notifications";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Every open AgentBnB tab, controlled by this worker or not. */
function windows() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true });
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const url = data.url || DEFAULT_URL;
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "AgentBnB", {
        body: data.body || undefined,
        icon: ICON,
        badge: BADGE,
        // One notification per thing (an application, a publication...): a newer one replaces the older.
        tag: data.tag || url,
        renotify: true,
        data: { id: data.id, url },
      }),
      // Open tabs refresh the header's bell right away.
      windows().then((list) => list.forEach((w) => w.postMessage({ type: "agentbnb:notification", id: data.id }))),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { id, url: path } = event.notification.data || {};
  const url = new URL(path || DEFAULT_URL, self.location.origin).href;
  event.waitUntil(
    Promise.all([
      // Opening it counts as reading it (the session cookie goes along with this request).
      id
        ? fetch("/api/notifications/read", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ids: [id] }),
          }).catch(() => {})
        : null,
      windows().then(async (list) => {
        const same = list.find((w) => w.url === url);
        if (same) return same.focus();
        // Reuse an open tab when we can (navigate() only works on tabs this worker controls).
        for (const w of list) {
          try {
            const moved = await w.navigate(url);
            if (moved) return moved.focus();
          } catch {}
        }
        return self.clients.openWindow(url);
      }),
    ]).then(() => windows().then((list) => list.forEach((w) => w.postMessage({ type: "agentbnb:notification", id })))),
  );
});

// The browser rotated the push subscription (it expired or was revoked): subscribe again with the
// same server key and save it, replacing the old endpoint.
self.addEventListener("pushsubscriptionchange", (event) => {
  const old = event.oldSubscription;
  event.waitUntil(
    (async () => {
      let sub = event.newSubscription;
      if (!sub) {
        let key = old && old.options && old.options.applicationServerKey;
        if (!key) {
          const res = await fetch("/api/push/subscription");
          key = res.ok ? (await res.json()).publicKey : null;
        }
        if (!key) return;
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      await fetch("/api/push/subscription", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), oldEndpoint: old ? old.endpoint : undefined }),
      });
    })(),
  );
});
