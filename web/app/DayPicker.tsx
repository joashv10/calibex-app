"use client";
// Day chip for the top bar + a month calendar. Pick any past day to see it across
// Today / Food / Training; gold dots mark days with anything logged, and each day is
// tinted by that morning's WHOOP recovery so patterns show before any statistics.
// Only today and the EDIT_DAYS before it take new entries (canEdit): older days are view-only.
// The chip turns gold while you're off today, so the day in view is never ambiguous.
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { EDIT_DAYS, canEdit, dayTitle, dayWord, setLogDay, useLogDay, wakeDate } from "@/lib/day";
import { ensureAuth, getLoggedDays } from "@/lib/data";
import { supabase } from "@/lib/supabaseClient";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const ymd = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export default function DayPicker({ todayLabel = "Today" }: { todayLabel?: string }) {
  const day = useLogDay();
  const [open, setOpen] = useState(false);
  const onToday = day === wakeDate();
  return (
    <>
      <button className={`daychip${onToday ? "" : " on"}`} onClick={() => setOpen(true)} aria-label="Pick a day">
        {onToday ? todayLabel : dayTitle(day)} <span aria-hidden>▾</span>
      </button>
      <AnimatePresence>
        {open && <Calendar day={day} onPick={(d) => { setLogDay(d); setOpen(false); }} onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  );
}

// Shown on older days, where logging is off.
export function ViewOnly() {
  const day = useLogDay();
  if (canEdit(day)) return null;
  return <div className="viewonly">Viewing {dayWord(day)}. You can add or change entries up to {EDIT_DAYS} days back.</div>;
}

function Calendar({ day, onPick, onClose }: { day: string; onPick: (d: string) => void; onClose: () => void }) {
  const today = wakeDate();
  const [y0, m0] = day.split("-").map(Number);
  const [ym, setYm] = useState({ y: y0, m: m0 - 1 });
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [rec, setRec] = useState<Map<string, number>>(new Map());

  const first = new Date(ym.y, ym.m, 1);
  const days = new Date(ym.y, ym.m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Monday-first grid
  const from = ymd(ym.y, ym.m, 1), to = ymd(ym.y, ym.m, days);
  const atCurrentMonth = to >= today;

  useEffect(() => {
    let live = true;
    ensureAuth().then(() => Promise.all([
      getLoggedDays(from, to),
      supabase.from("cycles").select("wake_date,recovery_score").gte("wake_date", from).lte("wake_date", to).not("recovery_score", "is", null),
    ])).then(([s, c]) => {
      if (!live) return;
      setLogged(s);
      setRec(new Map(((c.data ?? []) as { wake_date: string; recovery_score: number }[]).map((r) => [r.wake_date, Number(r.recovery_score)])));
    }).catch(console.error);
    return () => { live = false; };
  }, [from, to]);

  const shift = (n: number) => setYm(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  return (
    <motion.div className="sheet-bg" initial={{ backgroundColor: "rgba(0,0,0,0)" }} animate={{ backgroundColor: "rgba(0,0,0,0.55)" }}
      exit={{ backgroundColor: "rgba(0,0,0,0)" }} onClick={onClose}>
      <motion.div className="sheet cal" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 320 }} onClick={(e) => e.stopPropagation()}>
        <div className="cal-h">
          <button className="cal-nav" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <b>{first.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</b>
          <button className="cal-nav" onClick={() => shift(1)} disabled={atCurrentMonth} aria-label="Next month">›</button>
        </div>
        <div className="cal-grid">
          {WEEKDAYS.map((w, i) => <span className="cal-wd" key={i}>{w}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const d = ymd(ym.y, ym.m, i + 1);
            const r = rec.get(d);
            const tint = r == null ? null : r >= 67 ? "r-hi" : r >= 34 ? "r-mid" : "r-lo"; // WHOOP's own bands
            const cls = ["cal-d", tint, d === day && "sel", d === today && "today", logged.has(d) && "has"].filter(Boolean).join(" ");
            return <button key={d} className={cls} disabled={d > today} onClick={() => onPick(d)}>{i + 1}</button>;
          })}
        </div>
        <div className="cal-foot">
          <span className="cal-key"><i className="cal-dot" /> logged · tint = recovery
            <i style={{ background: "rgba(90,210,154,.5)" }} /><i style={{ background: "rgba(245,196,81,.45)" }} /><i style={{ background: "rgba(255,122,107,.5)" }} /></span>
          {day !== today && <button className="seclink" onClick={() => onPick(today)}>Today</button>}
        </div>
      </motion.div>
    </motion.div>
  );
}
