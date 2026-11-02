"use client";
// CALIBEX's own time picker, in place of iOS's stock wheel. Tap the time and three
// wheels open inline under the row (hour, minute, AM/PM). Scrolling sets the value
// as it goes, so there's no confirm step; tap the time again to close.
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

const EASE = [0.16, 1, 0.3, 1] as const;
const H = 40; // row height; the wheel shows five rows with the middle one picked

const pad = (n: number) => String(n).padStart(2, "0");

function parse(v: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})/.exec(v);
  if (m) return [Number(m[1]), Number(m[2])];
  const d = new Date();
  return [d.getHours(), d.getMinutes()];
}

export function label12(v: string) {
  const [h, m] = parse(v);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}

function Wheel({ items, index, onPick, name }: { items: string[]; index: number; onPick: (i: number) => void; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [near, setNear] = useState(index);
  // The settle timer fires after a re-render, so it reads the latest props through a ref.
  const latest = useRef({ index, onPick });
  useEffect(() => { latest.current = { index, onPick }; });

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = index * H;
    // Only on mount: after that the wheel's own scroll position is the source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / H)));
    setNear(i);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (i !== latest.current.index) latest.current.onPick(i); }, 90);
  };

  return (
    <div className="tf-wheel" ref={ref} onScroll={onScroll} role="listbox" aria-label={name}>
      <div className="tf-spacer" />
      {items.map((t, i) => (
        <button key={t} type="button" role="option" aria-selected={i === near}
          className={`tf-item ${i === near ? "on" : ""}`}
          onClick={() => ref.current?.scrollTo({ top: i * H, behavior: "smooth" })}>{t}</button>
      ))}
      <div className="tf-spacer" />
    </div>
  );
}

// value / onChange use "HH:MM" (24 h), same as <input type="time">.
export function TimeField({ value, onChange, step = 5, label }: { value: string; onChange: (v: string) => void; step?: number; label: string }) {
  const [open, setOpen] = useState(false);
  const [h, m] = parse(value);
  // An off-grid minute (14:37 from the clock) joins the list when the wheels open and
  // stays put while they're open, so the rows never shift under the wheel.
  const [extra, setExtra] = useState(m);

  const hours = Array.from({ length: 12 }, (_, i) => String(i || 12)); // 12, 1, 2 … 11
  const mins = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  if (!mins.includes(extra)) { mins.push(extra); mins.sort((a, b) => a - b); }

  const set = (hh: number, mm: number) => onChange(`${pad(hh)}:${pad(mm)}`);
  const pm = h >= 12;

  return (
    <>
      <button type="button" className={`tf-btn ${open ? "open" : ""}`} aria-label={label} aria-expanded={open}
        onClick={() => { if (!open) setExtra(m); setOpen(!open); }}>{label12(value)}</button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="tf-panel" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.32, ease: EASE }}>
            <div className="tf-wheels">
              <div className="tf-band" />
              <Wheel name="hour" items={hours} index={h % 12} onPick={(i) => set(i + (pm ? 12 : 0), m)} />
              <span className="tf-colon">:</span>
              <Wheel name="minute" items={mins.map(pad)} index={mins.indexOf(m)} onPick={(i) => set(h, mins[i])} />
              <Wheel name="AM or PM" items={["AM", "PM"]} index={pm ? 1 : 0} onPick={(i) => set((h % 12) + (i ? 12 : 0), m)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
