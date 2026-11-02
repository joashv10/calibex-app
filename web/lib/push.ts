"use client";
import { supabase } from "./supabaseClient";

// VAPID *public* key — safe to ship to the client (it's the applicationServerKey every
// browser receives). The private key stays server-side in GitHub secrets. Generate a pair
// with `npx web-push generate-vapid-keys`; without the env var, push is simply off.
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported() {
  return typeof window !== "undefined" &&
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// iOS only delivers Web Push to an *installed* (home-screen) PWA, never a Safari tab.
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export type PushResult = "ok" | "denied" | "unsupported" | "not-installed" | "error";

// Get (or create) this device's subscription and make sure the server holds a LIVE
// copy. push_status() answers for this endpoint only (the table itself has no SELECT
// policy, so endpoints stay unreadable to clients):
//   live    → nothing to do
//   dead    → the push service rejected it; drop it and subscribe afresh
//   missing → store it
// A plain insert, not an upsert: Postgres rejects ON CONFLICT without a SELECT
// policy. An endpoint's keys never change, so "already stored" (23505) is success.
async function saveSubscription(): Promise<boolean> {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const { data: st } = await supabase.rpc("push_status", { p_endpoint: sub.endpoint });
    if (st === "live") return true;
    if (st === "dead") { await sub.unsubscribe().catch(() => {}); sub = null; }
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID),
  });
  const j = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").insert({
    endpoint: j.endpoint,
    p256dh: j.keys?.p256dh,
    auth: j.keys?.auth,
    ua: navigator.userAgent.slice(0, 200),
  });
  if (error && error.code !== "23505") { console.error("push subscription not saved", error); return false; }
  return true;
}

export async function enablePush(): Promise<PushResult> {
  if (!pushSupported() || !VAPID) return "unsupported";
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (iOS && !isStandalone()) return "not-installed";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "denied";
  return (await saveSubscription()) ? "ok" : "error";
}

// Re-check the subscription on every open once permission is granted. Self-heals one
// the server marked dead, one iOS rotated, or one that never saved.
export async function syncPush(): Promise<boolean> {
  if (!pushSupported() || !VAPID || Notification.permission !== "granted") return false;
  try { return await saveSubscription(); } catch (e) { console.error(e); return false; }
}

// What the Today line should say about reminders on this phone.
export type PushState = "on" | "off" | "denied" | "not-installed" | "unsupported" | "broken";
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) {
    const iOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
    return iOS && !isStandalone() ? "not-installed" : "unsupported";
  }
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (iOS && !isStandalone()) return "not-installed";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return (await syncPush()) ? "on" : "broken";
}
