"use client";
// Cold-open splash: the reticle calibrates, pulses once, then dissolves into the app.
// Server-rendered + pure CSS, so it paints and animates before JS hydrates. Plays
// ~1.1s in full, but any tap skips it instantly so the capture loop
// never has to wait on it (design red line: never block the capture loop). It lives in the root layout, so
// client-side tab switches and PWA resumes never replay it — only a cold load does.
import { useState } from "react";

const TICKS = [
  { x1: 256, y1: 52, x2: 256, y2: 88, dx: 0, dy: -40 },
  { x1: 460, y1: 256, x2: 424, y2: 256, dx: 40, dy: 0 },
  { x1: 256, y1: 460, x2: 256, y2: 424, dx: 0, dy: 40 },
  { x1: 52, y1: 256, x2: 88, y2: 256, dx: -40, dy: 0 },
];

export default function Splash() {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <div
      className="splash"
      aria-hidden
      onPointerDown={() => setGone(true)}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) setGone(true); }}
    >
      <div className="splash-inner">
        <div className="splash-pulse" />
        <svg className="splash-mark" viewBox="0 0 512 512">
          <circle className="sp-ring" cx="256" cy="256" r="154" />
          {TICKS.map((t, i) => (
            <line key={i} className="sp-tick" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
              style={{ "--dx": `${t.dx}px`, "--dy": `${t.dy}px`, animationDelay: `${60 + i * 40}ms` } as React.CSSProperties} />
          ))}
          <g className="sp-x">
            <line x1="164" y1="164" x2="348" y2="348" />
            <line x1="164" y1="348" x2="348" y2="164" />
          </g>
          <g className="sp-dot">
            <circle cx="256" cy="256" r="18" fill="var(--gold)" />
            <circle cx="256" cy="256" r="8" fill="var(--bg)" />
          </g>
        </svg>
        <div className="splash-word">CALIBEX</div>
      </div>
    </div>
  );
}
