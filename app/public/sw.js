"use strict";

const DEFAULT_NOTIFICATION = {
  title: "Workshop ERP",
  body: "A new ERP notification has arrived.",
  url: "/",
  tag: "erp-notification"
};

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request));
});

async function latestNotification() {
  try {
    const response = await fetch("/api/notifications/latest", {
      credentials: "include",
      cache: "no-store",
      headers: { "Accept": "application/json", "Cache-Control": "no-store" }
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload && payload.notification ? payload.notification : null;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const item = await latestNotification() || DEFAULT_NOTIFICATION;
    await self.registration.showNotification(item.title || DEFAULT_NOTIFICATION.title, {
      body: item.body || DEFAULT_NOTIFICATION.body,
      icon: "/images/logo.svg",
      badge: "/images/logo.svg",
      tag: item.tag || DEFAULT_NOTIFICATION.tag,
      data: { url: item.url || DEFAULT_NOTIFICATION.url }
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windowClients) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if ("navigate" in client) {
        await client.navigate(targetUrl).catch(() => null);
      }
      return client.focus();
    }
    return self.clients.openWindow(targetUrl);
  })());
});
