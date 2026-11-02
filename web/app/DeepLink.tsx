"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { requestOpen } from "@/lib/deeplink";

// Receives "open this sheet" from the service worker when a reminder is tapped while
// the app is already running, and acks so the worker doesn't fall back to a reload.
export default function DeepLink() {
  const router = useRouter();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d?.type !== "calibex:open" || typeof d.url !== "string") return;
      e.ports?.[0]?.postMessage("ok");
      const path = new URL(d.url, window.location.origin).pathname;
      requestOpen(d.url);
      if (window.location.pathname !== path) router.push(d.url);
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [router]);
  return null;
}
