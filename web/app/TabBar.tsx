"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";

const TODAY = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
  </svg>
);
const FOOD = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 12h16a8 8 0 0 1-16 0Z" />
    <path d="M9 4.5c0 1.6-1 2-1 3.6M13 4.5c0 1.6-1 2-1 3.6" />
  </svg>
);
const TRAIN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
    <path d="M6.5 9v6M4.5 10.5v3M17.5 9v6M19.5 10.5v3M6.5 12h11" />
  </svg>
);
const PROGRESS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 15.5l4.5-4.5 3 3L20 6.5" />
    <path d="M15.5 6.5H20V11" />
  </svg>
);

// Insights: a scatter of dots on axes, what the findings are made of.
const INSIGHTS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4.5 4.5v15h15" />
    <circle cx="9" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="13" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

const TABS = [
  { href: "/", label: "Today", icon: TODAY },
  { href: "/food", label: "Food", icon: FOOD },
  { href: "/train", label: "Training", icon: TRAIN },
  { href: "/progress", label: "Progress", icon: PROGRESS },
  { href: "/insights", label: "Insights", icon: INSIGHTS },
] as const;

export default function TabBar() {
  const path = usePathname();
  const reduce = useReducedMotion();
  const [hidden, setHidden] = useState(false);

  // Instagram-style: the bar slides away on scroll-down (more content), back on
  // scroll-up or near the top. Disabled for reduced-motion.
  useEffect(() => {
    if (reduce) { setHidden(false); return; }
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y < 56) setHidden(false);          // always visible near the top
        else if (y - lastY > 6) setHidden(true);   // scrolling down
        else if (lastY - y > 6) setHidden(false);  // scrolling up
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [reduce]);

  // Always reveal on navigation (new screen starts at the top).
  useEffect(() => { setHidden(false); }, [path]);

  return (
    <nav className={`tabbar${hidden ? " hidden" : ""}`} aria-label="Sections">
      {TABS.map((t) => {
        const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`tab${active ? " on" : ""}`} aria-current={active ? "page" : undefined}>
            {active && (
              <motion.span
                layoutId="tab-glass"
                className="tab-glass"
                aria-hidden
                transition={reduce ? { duration: 0 } : { layout: { type: "tween", duration: 0.66, ease: [0.4, 0, 0.1, 1] } }}
              >
                <span className="tab-glass-sheen" />
              </motion.span>
            )}
            <span className="tab-ic">{t.icon}</span>
            <span className="tab-lb">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
