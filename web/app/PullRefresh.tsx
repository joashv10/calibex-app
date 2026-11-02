"use client";
import { useEffect, useRef, useState } from "react";

// Pull down from the top of any tab to reload the whole app. The home-screen app has
// no browser pull-to-refresh, and a reload also picks up a new deploy. Skipped while a
// sheet, the capture screen or onboarding is open, or when the touch starts in a field.
const ARM = 80; // px of (damped) pull that arms a reload; the page opens this gap for the dial
const MAX = 120;
const BLOCK = ".sheet-bg, .capture, .onboard, .splash, input, textarea, select, [contenteditable]";

export default function PullRefresh() {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false); // finger down: follow it 1:1, no easing
  const start = useRef<{ x: number; y: number } | null>(null);
  const cur = useRef(0);

  useEffect(() => {
    const reset = () => { start.current = null; cur.current = 0; setPull(0); setDrag(false); };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || window.scrollY > 0) return;
      if (document.documentElement.classList.contains("locked")) return;
      if ((e.target as Element | null)?.closest?.(BLOCK)) return;
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setDrag(true);
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      // a second finger or a mostly sideways swipe is not a pull
      if (e.touches.length > 1 || window.scrollY > 0) return reset();
      const dx = e.touches[0].clientX - start.current.x;
      const dy = e.touches[0].clientY - start.current.y;
      if (Math.abs(dx) > dy) { cur.current = 0; setPull(0); return; }
      cur.current = dy > 0 ? Math.min(dy * 0.5, MAX) : 0;
      setPull(cur.current);
    };
    const onEnd = (e: TouchEvent) => {
      if (start.current === null || e.touches.length) return;
      if (cur.current >= ARM) {
        start.current = null; setDrag(false); setBusy(true); setPull(ARM);
        // let the spinner register for a beat before the page goes away
        setTimeout(() => window.location.reload(), 350);
        return;
      }
      reset();
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", reset);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, []);

  // Like iOS, the page itself slides down and the dial sits in the gap it opens, so
  // nothing is drawn over the title. The transform is cleared at rest: a lingering one
  // would make it the containing block for the fixed sheets inside the page.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>("main.app > .body");
    if (!el) return;
    el.style.transition = drag ? "none" : "transform .42s cubic-bezier(.22,1,.36,1)";
    el.style.transform = pull ? `translateY(${pull}px)` : "";
  }, [pull, drag]);

  const p = Math.min(pull / ARM, 1);
  const armed = p >= 1 && !busy;
  const label = busy ? "Refreshing" : armed ? "Release to refresh" : "Pull to refresh";
  return (
    <div className={`ptr${drag ? " drag" : ""}${armed ? " armed" : ""}${busy ? " busy" : ""}`} aria-hidden={!pull && !busy}
      style={{ transform: `translate(-50%, ${Math.round(pull - 72)}px)`, opacity: busy ? 1 : Math.min(p * 1.6, 1) }}>
      <div className="ptr-dial">
        <svg className="ptr-ring" width="40" height="40" viewBox="0 0 40 40" aria-hidden>
          <circle cx="20" cy="20" r="17" pathLength={1} className="ptr-track" />
          <circle cx="20" cy="20" r="17" pathLength={1} className="ptr-arc"
            style={{ strokeDashoffset: busy ? 0.72 : 1 - p }} />
        </svg>
        <svg className="ptr-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 5v14" /><path d="m6 13 6 6 6-6" />
        </svg>
      </div>
      <span className="ptr-label" role="status">{p > 0.35 || busy ? label : ""}</span>
    </div>
  );
}
