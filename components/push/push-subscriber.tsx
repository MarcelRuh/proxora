"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { PROXORA_ANDROID_UA } from "@/lib/guest-tool-window";

function vapidToBytes(value: string): BufferSource {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function subscribeWebPush() {
  if (typeof window === "undefined") return;
  if (navigator.userAgent.includes(PROXORA_ANDROID_UA)) return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
  if (Notification.permission === "denied") return;
  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;
  }
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await registration.update().catch(() => undefined);
  const { publicKey } = await api<{ publicKey: string }>("/api/push/vapid");
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidToBytes(publicKey),
    });
  }
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
  await api("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    }),
  });
}

export function PushSubscriber() {
  useEffect(() => {
    void subscribeWebPush().catch(() => undefined);
  }, []);
  return null;
}
