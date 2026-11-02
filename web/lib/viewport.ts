"use client";
import { useEffect, useState } from "react";

// The part of the screen you can actually see. On iOS the soft keyboard shrinks the
// VISUAL viewport (and may pan it) but not the layout viewport, so a fixed bottom
// sheet sized to the screen slides partly behind the keyboard with its top pushed
// off-screen. Sheets with text inputs pin their overlay to this box instead, so they
// sit right on top of the keyboard with their search box / footer in view.
export function useVisibleViewport(): { top: number; height: number } | null {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setBox({ top: vv.offsetTop, height: vv.height });
    on();
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    return () => { vv.removeEventListener("resize", on); vv.removeEventListener("scroll", on); };
  }, []);
  return box;
}

// The soft keyboard is up: the visible area is well short of the screen. Sheets use it
// to drop their footer while you type, so the fields keep the space.
export function keyboardUp(box: { top: number; height: number } | null) {
  // Measured against the screen, not innerHeight: in an iOS home-screen app innerHeight
  // shrinks with the keyboard too, so it can't tell the keyboard is there.
  if (!box || typeof window === "undefined") return false;
  const { width, height } = window.screen; // iOS reports portrait sizes even in landscape
  const tall = window.innerWidth > window.innerHeight + 100 ? Math.min(width, height) : Math.max(width, height);
  return box.height < tall * 0.7;
}

// Overlay + sheet styles for a sheet pinned to the visible area (keyboard-aware).
export function pinnedSheet(box: { top: number; height: number } | null) {
  if (!box) return { overlay: undefined, sheet: undefined };
  const cap = typeof window !== "undefined" ? window.innerHeight * 0.9 : box.height;
  return {
    overlay: { top: box.top, height: box.height, bottom: "auto" as const },
    sheet: { maxHeight: Math.min(box.height - 12, cap) },
  };
}
