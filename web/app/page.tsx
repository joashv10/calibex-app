"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useSpring } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Item, SamplerState, Touchpoint } from "@/lib/types";
import { sampleTouchpoint, orderForCapture, TOUCHPOINTS } from "@/lib/sampler";
import { canEdit, currentTouchpoint, dayTitle, isBackfill, logDate, setLogDay, useLogDay, wakeDate, yesterdayDate } from "@/lib/day";
import DayPicker, { ViewOnly } from "./DayPicker";
import { enablePush, pushState, syncPush, type PushState } from "@/lib/push";
import * as db from "@/lib/data";
import { getDayEnergy, skipMeal, type DayEnergy } from "@/lib/food";
import * as body from "@/lib/body";
import { useTapLog } from "@/lib/useTapLog";
import { cachedSettings, clock, getSettings, saveSettings, toMin, usualWake, type Settings } from "@/lib/settings";
import { addDays, dayFacts, getCycles, getExcludedDays, getTimeline, hm, normalBefore, signed, type Cycle, type DayLine } from "@/lib/readout";
import { excludeDays, lateNight, morningHeadline, runH0, type Finding } from "@/lib/stats";
import { fmtSteps, fmtStepsDelta } from "@/lib/steps";
import { useOpenRequest } from "@/lib/deeplink";
import { Setup, ScheduleSheet } from "./Setup";
import { CONTEXT_OPTIONS, contextLinkText } from "@/lib/dayContext";
import UndoIcon from "./UndoIcon";

// Day-phase order — used to mark which touchpoint is due NOW vs still-to-come.
const TP_ORDER: Record<string, number> = { breakfast: 0, lunch: 1, afternoon: 2, post_workout: 2, dinner: 3 };
// Reminder URLs (/?open=…) → the check-in they open.
const OPEN_TP: Record<string, Touchpoint> = { morning: "breakfast", post_workout: "post_workout", dinner: "dinner", lunch: "lunch", weekly_review: "weekly_review" };
// Every question carries its pillar.
const PILLAR: Record<string, string> = {
  load: "Training load", recovery_state: "Recovery", sleep: "Sleep", readiness: "Readiness", fueling: "Fueling",
  substances: "Substances", life_demand: "Life demand", social: "Social", sustainability: "Sustainability",
};
// Urine colour: four clearly different swatches, pale → dark. No numbers.
const SWATCH: Record<string, string> = { "Pale": "#f7f3d6", "Light yellow": "#f2e58a", "Yellow": "#e4c23a", "Dark": "#b9801a" };

const EASE = [0.16, 1, 0.3, 1] as const;
const fade = (delay: number, reveal = true) =>
  reveal
    ? { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.55, ease: EASE } }
    : { initial: false as const, animate: { opacity: 1, y: 0 }, transition: { duration: 0 } };

// Light haptic on touch — non-blocking, no-op where unsupported (e.g. iOS Safari).
const haptic = (ms = 8) => {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try { navigator.vibrate(ms); } catch {}
  }
};

// Reveal the hero showpiece (count-up + scale-in) only on a fresh load, not after every
// capture. Module-scoped: survives re-renders, resets on a real page reload.
let didReveal = false;
let gyroAsked = false;

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [state, setState] = useState<Map<string, SamplerState>>(new Map());
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [skipDays, setSkipDays] = useState<string[]>([]);
  const [timeline, setTimeline] = useState<DayLine[]>([]);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [context, setContext] = useState("normal");
  const [daysLogged, setDaysLogged] = useState(0);
  const [stool, setStool] = useState<body.Stool[]>([]);
  const [energy, setEnergy] = useState<(DayEnergy & { day: string }) | null>(null); // tagged: numbers lag a day switch until load() lands
  const [weight, setWeight] = useState<number | null>(null); // today's weigh-in, so the done cards never load it themselves
  const [capTp, setCapTp] = useState<Touchpoint | null>(null);
  const [cards, setCards] = useState<Item[]>([]);
  const [settings, setSettings] = useState<Settings | null>(() => cachedSettings());
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [loadedDay, setLoadedDay] = useState<string | null>(null);
  const [, bump] = useState(0); // force a re-render (re-derive time-of-day) on PWA resume
  const day = useLogDay(); // the day in view (today unless picked from the calendar)
  const past = day !== wakeDate();
  const editable = canEdit(day);
  const name = settings?.name ?? null;
  const tz = settings?.tz || "Asia/Kolkata";
  const saveName = useCallback((v: string | null) => {
    const t = (v ?? "").trim() || null;
    setSettings((s) => (s ? { ...s, name: t } : s));
    saveSettings({ name: t }).catch(console.error);
  }, []);
  // Pointer-driven 3D tilt for the hero (spring-damped so it feels weighted, not jittery).
  const tiltX = useSpring(0, { stiffness: 140, damping: 16 });
  const tiltY = useSpring(0, { stiffness: 140, damping: 16 });
  const [reduced, setReduced] = useState(false);
  const capTpRef = useRef<Touchpoint | null>(null);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(m.matches);
    apply(); m.addEventListener("change", apply);
    return () => m.removeEventListener("change", apply);
  }, []);
  useEffect(() => { capTpRef.current = capTp; }, [capTp]);
  // Gyroscope → hero 3D tilt: moves as you physically move the phone. Gated off for
  // reduced-motion, paused during capture, deadzone + calm range so it never jitters.
  useEffect(() => {
    if (reduced) return;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (capTpRef.current || e.gamma == null || e.beta == null) return;
      const g = Math.abs(e.gamma) < 2 ? 0 : e.gamma;
      const b = Math.abs(e.beta - 40) < 2 ? 0 : e.beta - 40;
      tiltY.set(Math.max(-6, Math.min(6, g * 0.2)));
      tiltX.set(Math.max(-6, Math.min(6, -b * 0.14)));
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [tiltX, tiltY, reduced]);

  const load = useCallback(async () => {
    await db.ensureAuth();
    const d = logDate();
    const [its, st, dn, an, ctx, dl, cy, tl, se, sl, sk, wt, en] = await Promise.all([
      db.getItems(), db.getSamplerState(),
      db.getTouchpointStatus(), db.getTodayResponses(), db.getDayContext(), db.getDaysLogged(),
      getCycles(), getTimeline(wakeDate(), 7), getSettings(), body.getTodayStool(), getExcludedDays(),
      db.getTodayWeight().catch(() => null), // a failed lookup just means "ask again"
      getDayEnergy().catch(() => null),
    ]);
    setEnergy(en && { ...en, day: d }); setStool(sl); setWeight(wt); setItems(its); setState(st);
    setDone(dn); setAnswered(an); setContext(ctx); setDaysLogged(dl);
    setCycles(cy); setTimeline(tl); setSkipDays(sk);
    // The name used to live only on this device: carry it into the database once.
    let local: string | null = null;
    try { local = localStorage.getItem("calibex_name"); } catch {}
    if (se && !se.name && local) { se.name = local; saveSettings({ name: local }).catch(console.error); }
    setSettings(se);
    setLoadedDay(d);
    setLoading(false);
  }, []);
  useEffect(() => { load().catch((e) => { console.error(e); setLoading(false); }); }, [load, day]);
  useEffect(() => { if (!loading) didReveal = true; }, [loading]);
  // On PWA resume (iOS suspends rather than kills), refetch + re-derive now-dependent
  // state so the greeting / date / "current" touchpoint aren't stale from hours ago.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") { bump((t) => t + 1); load().catch(() => {}); } };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  const today = wakeDate();
  const late = useMemo(() => lateNight(cycles, today, tz), [cycles, today, tz]);
  const openCapture = useCallback((tp: Touchpoint) => {
    const shown = sampleTouchpoint(items, state, tp, answered, context);
    // Order lives in orderForCapture (tested). A late night adds "what kept you up?" at the end.
    const ordered = orderForCapture(shown, tp);
    if (tp === "breakfast" && late && !isBackfill()) {
      const sl2 = items.find((i) => i.touchpoint === "late_night" && !answered.has(i.item_id));
      if (sl2) ordered.push(sl2);
    }
    if (ordered.length === 0) return;
    setCards(ordered);
    setCapTp(tp);
    db.recordShown(ordered.map((i) => i.item_id), state).catch(console.error);
  }, [items, state, answered, context, late]);

  // A reminder tap: /?open=morning|post_workout|dinner opens that check-in on today.
  const router = useRouter();
  const { value: openReq, consume: consumeOpen } = useOpenRequest("/", "open");
  useEffect(() => {
    if (!openReq) return;
    if (past) { setLogDay(null); return; } // reloads on today, then this runs again
    if (loading || loadedDay !== today) return;
    const tp = OPEN_TP[openReq];
    consumeOpen();
    if (tp === "lunch") { router.push("/food?add=lunch"); return; }
    if (tp && !done[tp] && !capTp) openCapture(tp);
  }, [openReq, past, loading, loadedDay, today, done, capTp, openCapture, consumeOpen, router]);

  // Travel and sick days (and today's partial steps/strain) stay out of every H0 test.
  const findings = useMemo(() => (cycles.length ? runH0(excludeDays(cycles, skipDays, today), tz) : []), [cycles, skipDays, today, tz]);
  const firstPass = findings.find((f) => f.status === "pass") ?? null;
  const wake = useMemo(() => usualWake(cycles.map((c) => c.sleep_end), tz), [cycles, tz]);

  if (loading) return <HomeSkeleton />;

  const needsSetup = !settings?.setup_done_at;
  const byDay = new Map(cycles.map((c) => [c.wake_date, c]));
  const lastSettled = [...cycles].reverse().find((r) => r.recovery_score != null);
  // Instrument honesty: month-old data must never present as "last night's".
  // Fresh = the latest settled cycle is from today or yesterday; anything older
  // gets date-stamped and flagged as a stalled sync instead of implying liveness.
  const freshData = lastSettled != null && (lastSettled.wake_date === today || lastSettled.wake_date === yesterdayDate());
  // Looking at a past day: the hero shows that day's own WHOOP cycle.
  const shown = past ? byDay.get(day) ?? null : lastSettled ?? null;
  const reveal = !didReveal;
  // Weekly review shows on the Sunday wake day only (1:30 AM Sunday is still Saturday).
  const weeklyDay = editable && new Date(`${wakeDate()}T12:00:00`).getDay() === 0 && !isBackfill();
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
  // Backfilling yesterday: nothing is "due now" or "still to come", every touchpoint is open.
  const curTp = past ? null : currentTouchpoint(now);
  const curOrder = curTp ? (TP_ORDER[curTp] ?? 2) : 99;
  const vs = (key: keyof Cycle) => {
    if (!shown || shown[key] == null) return null;
    const n = normalBefore(cycles, shown.wake_date, key);
    return n == null ? null : Math.round(Number(shown[key]) - n);
  };
  const recVs = vs("recovery_score");
  const headline = !past && shown && shown.wake_date === today ? morningHeadline(cycles, today) ?? sleepLine(shown, tz) : null;
  const rowTime: Record<string, string | null> = {
    breakfast: byDay.get(today)?.recovery_score != null ? "4 taps" : "after you wake",
    lunch: settings?.lunch ? clock(toMin(settings.lunch) ?? 0) : null,
    post_workout: "after a session",
    dinner: settings?.dinner ? clock(toMin(settings.dinner) ?? 0) : null,
  };

  return (
    <main className="app">
      <div className="body">
        <motion.div className="topbar" {...fade(0, reveal)}>
          <span className="brand"><span className="logomark" aria-hidden />CALIBEX</span>
          <DayPicker todayLabel={dateStr} />
        </motion.div>

        <Greeting name={name} onSave={saveName} reveal={reveal} />

        <motion.div animate={reduced ? { y: 0 } : { y: [0, -4, 0] }}
          transition={reduced ? { duration: 0 } : { duration: 6.5, repeat: Infinity, ease: "easeInOut" }}>
        <motion.section className="hero" {...fade(0.06, reveal)}
          style={{ rotateX: tiltX, rotateY: tiltY, transformPerspective: 1100 }}
          onPointerMove={(e) => {
            if (reduced) return;
            const r = e.currentTarget.getBoundingClientRect();
            tiltX.set(-(((e.clientY - r.top) / r.height) - 0.5) * 9);
            tiltY.set((((e.clientX - r.left) / r.width) - 0.5) * 11);
          }}
          onPointerLeave={() => { tiltX.set(0); tiltY.set(0); }}
          onPointerDown={() => {
            if (gyroAsked) return; gyroAsked = true;
            const DOE = (globalThis as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
            DOE?.requestPermission?.().catch(() => {});
          }}>
          <div className="lbl">{past ? <>Recovery · {dayTitle(day)}</> : freshData || !lastSettled ? <>Last night&apos;s recovery</> : <>Recovery · {fmtAxis(lastSettled.wake_date)}</>}</div>
          <motion.div className="num"
            initial={reveal ? { opacity: 0, scale: 0.92 } : false}
            animate={{ opacity: 1, scale: 1 }}
            transition={reveal ? { delay: 0.14, type: "spring", damping: 16, stiffness: 220 } : { duration: 0 }}>
            {shown?.recovery_score != null
              ? <>{Math.round(shown.recovery_score)}<small>%</small></>
              : "—"}
          </motion.div>
          {recVs != null && shown?.recovery_score != null && <div className="vsn">{signed(recVs)} vs your normal</div>}
          {headline && <div className="mhead">{headline}</div>}
          {(past ? shown?.recovery_score == null : !freshData) && (
            <div className="sub"><i className={!past && lastSettled && !freshData ? "warn" : undefined} /> {
              past ? "no WHOOP recovery for this day"
              : !lastSettled ? "first reading lands tomorrow morning"
              : `WHOOP sync stalled — last data ${fmtAxis(lastSettled.wake_date)}`
            }</div>
          )}
          <Sparkline data={cycles.slice(-14)} />
          <div className="vitals">
            {[
              { v: fmtv(shown?.hrv_rmssd_ms), d: vs("hrv_rmssd_ms"), l: "HRV ms" },
              { v: fmtv(shown?.resting_heart_rate), d: vs("resting_heart_rate"), l: "RHR bpm" },
              { v: fmtv(shown?.sleep_performance_percent), d: vs("sleep_performance_percent"), l: "Sleep %" },
              // Today's strain is still accumulating: no comparison until the day is over.
              { v: shown?.day_strain != null ? shown.day_strain.toFixed(1) : "—", d: shown?.wake_date === today ? null : vs("day_strain"), t: shown?.wake_date === today && shown?.day_strain != null ? "so far" : null, l: "Strain" },
              // Same for steps: today's count is partial (synced every ~2h), so no comparison until the day is over.
              { v: shown?.step_count != null ? fmtSteps(shown.step_count) : "—", d: shown?.wake_date === today ? null : vs("step_count"), t: shown?.wake_date === today && shown?.step_count != null ? "so far" : null, l: "Steps", f: fmtStepsDelta },
            ].map((vit, i) => (
              <motion.div className="vital" key={vit.l}
                initial={reveal ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }}
                transition={reveal ? { delay: 0.5 + i * 0.08, duration: 0.4, ease: EASE } : { duration: 0 }}>
                <b>{vit.v}</b>{vit.d != null ? <em>{(vit.f ?? signed)(vit.d)}</em> : vit.t && <em>{vit.t}</em>}<span>{vit.l}</span>
              </motion.div>
            ))}
          </div>
          <div className="vit-note">± vs your normal (last 28 scored days)</div>
        </motion.section>
        </motion.div>

        {energy && <motion.div {...fade(0.1, reveal)}><EnergyStrip e={energy} stale={energy.day !== day} /></motion.div>}

        <motion.div {...fade(0.13, reveal)}>
          <div className="sec-h"><span>{dayTitle(day)}</span><span>{daysLogged > 0 ? `Day ${daysLogged}` : "Start"}</span></div>
          <ViewOnly />
          <div className="rows">
            {TOUCHPOINTS.map((tp) => {
              const isDone = !!done[tp.id];
              const o = TP_ORDER[tp.id] ?? 2;
              const phase = isDone ? "done"
                // Lit only once WHOOP has a session today; otherwise quietly available.
                : tp.id === "post_workout" ? (!past && timeline[0]?.day === today && timeline[0].sessions.length ? "open" : "future")
                : tp.id === curTp || (tp.id === "lunch" && curTp === "afternoon") ? "current"
                : o > curOrder ? "future" : "open";
              return (
                <Fragment key={tp.id}>
                <motion.button className={`row ${phase}`}
                  whileTap={isDone ? undefined : { scale: 0.975 }}
                  transition={{ type: "spring", damping: 20, stiffness: 400 }}
                  onClick={() => !isDone && editable && openCapture(tp.id)} disabled={isDone || !editable}>
                  <span className="nm">{tp.label}</span>
                  {isDone ? <span className="ck">✓</span> : <>
                    {!past && rowTime[tp.id] && <span className="t">{rowTime[tp.id]}</span>}
                    {editable && <span className="ar">→</span>}
                  </>}
                </motion.button>
                {tp.id === "breakfast" && weeklyDay && (done.weekly_review
                  ? <div className="row wkr done"><span className="nm">Weekly review · done</span><span className="ck">✓</span></div>
                  : <motion.button className="row wkr" whileTap={{ scale: 0.975 }}
                      transition={{ type: "spring", damping: 20, stiffness: 400 }} onClick={() => openCapture("weekly_review")}>
                      <span className="nm">Weekly review<span className="sub">6 quick questions + weigh-in · about a minute</span></span>
                      <span className="ar">›</span>
                    </motion.button>)}
                </Fragment>
              );
            })}
          </div>
          <StoolRow key={day} stool={stool} editable={editable} past={past} onChange={load} />
          {editable && <ContextLine context={context} onOpen={() => setCtxOpen(true)} />}
          <RemindersLine onEdit={() => setScheduleOpen(true)} />
        </motion.div>

      </div>

      <AnimatePresence>
        {capTp && <Capture key="cap" tp={capTp} cards={cards} recap={capTp === "breakfast" && !past ? morningRecap(timeline, cycles, today) : null}
          weight={weight} onWeighed={setWeight}
          onClose={async () => { setCapTp(null); await load(); }}
          onDone={async () => { setCapTp(null); await load(); }} />}
      </AnimatePresence>
      <AnimatePresence>
        {needsSetup && <Setup key="setup" wake={wake} name={name}
          onDone={(p) => setSettings((s) => ({ ...(s ?? DEFAULT_SETTINGS), ...p }))} />}
      </AnimatePresence>
      <AnimatePresence>
        {ctxOpen && <ContextSheet key="ctx" context={context} onClose={() => setCtxOpen(false)}
          onPick={async (c) => { await db.setDayContext(c); setCtxOpen(false); await load(); }} />}
      </AnimatePresence>
      <AnimatePresence>
        {scheduleOpen && settings && <ScheduleSheet key="sched" settings={settings} wake={wake}
          onClose={() => setScheduleOpen(false)} onSaved={(p) => setSettings((s) => (s ? { ...s, ...p } : s))} />}
      </AnimatePresence>
      <AnimatePresence>
        {!needsSetup && !capTp && firstPass && settings && !settings.finding_revealed && (
          <FirstFinding key="ff" f={firstPass} onClose={() => {
            setSettings((s) => (s ? { ...s, finding_revealed: firstPass.id } : s));
            saveSettings({ finding_revealed: firstPass.id }).catch(console.error);
          }} />
        )}
      </AnimatePresence>
    </main>
  );
}

const DEFAULT_SETTINGS: Settings = {
  name: null, tz: "Asia/Kolkata", first_meal: null, lunch: null, dinner: null,
  remind_morning: true, remind_lunch: true, remind_session: true, remind_dinner: true,
  setup_done_at: null, finding_revealed: null, bottle_ml: 500,
};


// Plain line about last night when there's no personal best to mention.
function sleepLine(c: Cycle, tz: string): string | null {
  if (c.total_sleep_minutes == null || !c.sleep_start) return null;
  const h = Math.floor(c.total_sleep_minutes / 60), m = Math.round(c.total_sleep_minutes % 60);
  return `Slept ${h}h ${String(m).padStart(2, "0")}m, asleep at ${hm(c.sleep_start, tz)}.`;
}

// The morning done card: yesterday next to this morning's number.
function morningRecap(timeline: DayLine[], cycles: Cycle[], today: string): string | null {
  const c = cycles.find((x) => x.wake_date === today);
  if (c?.recovery_score == null) return null;
  const n = normalBefore(cycles, today, "recovery_score");
  const facts = dayFacts(timeline.find((d) => d.day === addDays(today, -1)), cachedSettings()?.tz || "Asia/Kolkata")
    .filter((x) => !x.includes("check-in"));
  const rec = `recovery ${Math.round(c.recovery_score)}${n != null ? ` (${signed(Math.round(c.recovery_score - n))} vs normal)` : ""}`;
  return facts.length ? `Yesterday: ${facts.join(" · ")}. This morning: ${rec}.` : `This morning: ${rec}.`;
}

// One-time reveal when the first question passes its gate.
function FirstFinding({ f, onClose }: { f: Finding; onClose: () => void }) {
  return (
    <motion.div className="sheet-bg" initial={{ backgroundColor: "rgba(0,0,0,0)" }} animate={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      exit={{ backgroundColor: "rgba(0,0,0,0)" }} onClick={onClose} style={{ alignItems: "center" }}>
      <motion.div className="reveal" initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }} transition={{ type: "spring", damping: 22, stiffness: 240 }} onClick={(e) => e.stopPropagation()}>
        <motion.div className="done-ring" initial={{ scale: 0.6, opacity: 0.7 }} animate={{ scale: 2.4, opacity: 0 }}
          transition={{ duration: 1.1, ease: "easeOut", delay: 0.15 }} />
        <div className="kik">First finding</div>
        <h2>{f.headline}</h2>
        <p>{f.question} From {f.n} days of your WHOOP data, worth about {f.ess} independent ones.</p>
        <button className="logfood" onClick={onClose}>Got it</button>
      </motion.div>
    </motion.div>
  );
}

// Warm, time-aware preamble on Today. The name lives only in localStorage; tapping it
// (or the "add your name" link when unset) reveals an inline field to set or edit it.
function Greeting({ name, onSave, reveal }: { name: string | null; onSave: (v: string | null) => void; reveal: boolean }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const cancelRef = useRef(false);
  // Same phase boundaries as currentTouchpoint (lib/day.ts) so the greeting never
  // says "morning" while lunch is already lit.
  const h = new Date().getHours();
  const word = h < 11 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  // Escape cancels (onBlur fires on unmount, so a ref gates it). An emptied field
  // keeps a previously-set name rather than silently wiping it — no data-loss trap.
  const commit = () => {
    if (cancelRef.current) { cancelRef.current = false; setEditing(false); return; }
    const v = val.trim();
    onSave(v || name || null);
    setEditing(false);
  };
  const cancel = () => { cancelRef.current = true; setEditing(false); };
  if (editing) {
    return (
      <motion.div className="greet" {...fade(0.03, reveal)}>
        <input className="greet-input" autoFocus placeholder="your name" value={val} maxLength={24}
          autoCapitalize="words"
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") cancel(); }}
          onBlur={commit} />
      </motion.div>
    );
  }
  return (
    <motion.div className="greet" {...fade(0.03, reveal)}>
      <span className="greet-word">{word}</span>
      {name
        ? <>, <button className="greet-name" onClick={() => { setVal(name); setEditing(true); }}>{name}</button></>
        : <button className="greet-add" onClick={() => { setVal(""); setEditing(true); }}>add your name</button>}
    </motion.div>
  );
}

function Capture({ tp, cards, recap, weight, onWeighed, onClose, onDone }: {
  tp: Touchpoint; cards: Item[]; recap: string | null;
  weight: number | null; onWeighed: (kg: number) => void; // today's weigh-in, loaded with the page
  onClose: () => void; onDone: () => void;
}) {
  const [cur, setCur] = useState(0);
  const [finished, setFinished] = useState(false);
  const weighed = weight != null; // today's weight already in: the weekly flow's skip button becomes "done"
  const [answers, setAnswers] = useState<Record<number, string | null>>({});
  const total = cards.length;
  const router = useRouter();
  const isMeal = ["lunch", "afternoon", "dinner"].includes(tp);
  const isMorning = tp === "breakfast"; // closes on yesterday's readout + "log first meal"
  const isWeekly = tp === "weekly_review"; // weekly check-in closes with the weigh-in
  // Sunday's weigh-in rides the morning. The waking day's weekday, not the clock's: 1:30 AM Sunday is still Saturday.
  const sunday = new Date(`${wakeDate()}T12:00:00`).getDay() === 0 && !isBackfill();

  // Per_occurrence items (a 2nd training session / re-logged meal same day) must APPEND a
  // new occurrence, not overwrite the first. Compute a stable per-item occurrence ONCE at
  // mount from today's existing rows; re-answering within this session reuses it (upsert
  // updates the same row, not a 3rd). Daily items stay at occurrence 1.
  const occ = useRef<Record<string, number>>({});
  useEffect(() => {
    const ids = cards.filter((c) => c.per_occurrence).map((c) => c.item_id);
    if (ids.length === 0) return;
    db.getTodayOccurrences(ids).then((counts) => {
      const m: Record<string, number> = {};
      for (const id of ids) m[id] = (counts[id] ?? 0) + 1;
      occ.current = m;
    }).catch(console.error);
  }, [cards]);

  const save = useCallback((item: Item, rawValue: string | null, rawJson: unknown, status: "answered" | "skipped") => {
    const sev = status === "answered" && rawValue != null ? item.severity_map?.[rawValue] ?? null : null;
    db.saveResponse({ itemId: item.item_id, occurrence: item.per_occurrence ? (occ.current[item.item_id] ?? 1) : 1,
      rawValue, rawJson, severity: sev, status, touchpoint: tp,
      // A backfilled event's real time is unknown: leave it null rather than stamp "now".
      eventAt: item.event_timed && !isBackfill() ? new Date().toISOString() : null }).catch(console.error);
  }, [tp]);

  const closingRef = useRef(false);
  const finish = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    onDone();
  }, [onDone]);
  const advance = useCallback(() => {
    if (cur >= total - 1) { setFinished(true); haptic(14); if (!isMeal && !isWeekly && !isMorning) setTimeout(finish, 850); }
    else setCur((c) => Math.min(c + 1, total - 1)); // clamp — a double-tap mid-transition must never run past the deck
  }, [cur, total, finish, isMeal, isWeekly, isMorning]);

  const label = (TOUCHPOINTS.find((t) => t.id === tp)?.label ?? "Weekly review").toUpperCase();

  return (
    <motion.div className="capture" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
      transition={{ type: "spring", damping: 34, stiffness: 330 }}>
      <div className="cap-top">
        <button className="x" onClick={() => setCur((c) => Math.max(0, c - 1))}
          style={{ visibility: cur > 0 && !finished ? "visible" : "hidden" }}>‹</button>
        <span className="ttl">{label}</span>
        <button className="x" onClick={onClose}>✕</button>
      </div>
      <div className="prog">
        {cards.map((_, i) => <i key={i} className={i < cur || finished ? "done" : i === cur ? "on" : ""} />)}
        <span className="progn">{finished ? total : cur + 1} / {total}</span>
      </div>
      <div className="deck">
        <AnimatePresence mode="popLayout" initial={false}>
          {!finished ? (
            <motion.div key={cur} className="qcard"
              initial={{ opacity: 0, x: 44 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -44 }}
              transition={{ type: "spring", damping: 30, stiffness: 350 }}>
              <QCard item={cards[Math.min(cur, total - 1)]} initialSel={answers[cur] ?? null}
                onAnswer={(rv, rj) => { setAnswers((a) => ({ ...a, [cur]: rv })); save(cards[Math.min(cur, total - 1)], rv, rj, "answered"); advance(); }}
                onSkip={() => { setAnswers((a) => ({ ...a, [cur]: null })); save(cards[Math.min(cur, total - 1)], null, null, "skipped"); advance(); }} />
            </motion.div>
          ) : (
            <motion.div key="done" className="done-card" onClick={isMeal || isWeekly || isMorning ? undefined : finish}
              initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", damping: 20, stiffness: 260 }}>
              <div className="checkwrap">
                <motion.div className="done-ring"
                  initial={{ scale: 0.55, opacity: 0.65 }} animate={{ scale: 2.6, opacity: 0 }}
                  transition={{ duration: 0.7, ease: "easeOut", delay: 0.1 }} />
                <motion.div className="check" initial={{ scale: 0, rotate: -25 }} animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", damping: 11, stiffness: 230, delay: 0.06 }}>✓</motion.div>
              </div>
              <h2>Logged.</h2>
              {isMorning && recap ? <p className="recap">{recap}</p> : <p>That&apos;s captured. Nothing else is owed.</p>}
              {isMorning && (
                <motion.div className="done-actions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.28, duration: 0.4, ease: EASE }}>
                  {sunday && <WeighInPrompt weight={weight} onSaved={onWeighed} onDone={() => {}} autoFocus={false} note="Sunday weigh-in, before you eat" />}
                  <button className="logfood" onClick={(e) => { e.stopPropagation(); haptic(); router.push(`/food?add=breakfast${isBackfill() ? "&keep=1" : ""}`); }}>Log first meal →</button>
                  <button className="done-skip" onClick={(e) => { e.stopPropagation(); finish(); }}>later</button>
                </motion.div>
              )}
              {isMeal && (
                <motion.div className="done-actions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.28, duration: 0.4, ease: EASE }}>
                  <button className="logfood" onClick={(e) => { e.stopPropagation(); haptic(); router.push(`/food?add=${tp}${isBackfill() ? "&keep=1" : ""}`); }}>+ log what you ate →</button>
                  {/* Records the skip so it isn't read as "forgot to log". Fire-and-forget: closing stays instant. */}
                  <button className="done-skip" onClick={(e) => { e.stopPropagation(); haptic(); skipMeal(tp).catch(console.error); finish(); }}>
                    {tp === "afternoon" ? "no snack" : "didn't eat"}</button>
                  {/* Dinner only: a drinking answer to AL1 offers the drink logger. "None" just moves on. */}
                  {cards.some((c, k) => c.item_id === "AL1" && answers[k] && answers[k] !== "None") && (
                    <button className="done-skip" onClick={(e) => { e.stopPropagation(); haptic(); router.push(`/food?drink=1${isBackfill() ? "&keep=1" : ""}`); }}>Log your drinks →</button>
                  )}
                  <button className="done-skip" onClick={(e) => { e.stopPropagation(); finish(); }}>done</button>
                </motion.div>
              )}
              {isWeekly && (
                <motion.div className="done-actions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.28, duration: 0.4, ease: EASE }}>
                  {/* A weigh-in is always now, so a backfilled review doesn't ask for one */}
                  {!isBackfill() && <WeighInPrompt weight={weight} onSaved={onWeighed} onDone={finish} />}
                  <button className="done-skip" onClick={(e) => { e.stopPropagation(); finish(); }}>{isBackfill() || weighed ? "done" : "skip weigh-in"}</button>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// The question's pillar, and an ⓘ that opens one line on why it's asked.
function Kik({ item }: { item: Item }) {
  const [why, setWhy] = useState(false);
  return (
    <div className="kikwrap">
      <div className={`kik ${item.is_protective ? "prot" : ""}`}>
        {PILLAR[item.dimension_id] ?? facetLabel(item)}{item.is_protective ? " · a good thing" : ""}
        {item.why && <button className="why-b" aria-label="Why we ask" aria-expanded={why} onClick={() => setWhy((w) => !w)}>ⓘ</button>}
      </div>
      <AnimatePresence initial={false}>
        {why && item.why && (
          <motion.p className="why" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: EASE }}>{item.why}</motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function QCard({ item, initialSel, onAnswer, onSkip }: {
  item: Item; initialSel?: string | null; onAnswer: (rawValue: string | null, rawJson: unknown) => void; onSkip: () => void;
}) {
  const [sel, setSel] = useState<string | null>(initialSel ?? null);
  const [multi, setMulti] = useState<string[]>(initialSel ? initialSel.split(",").filter(Boolean) : []);
  const goodOption = item.is_protective ? Object.entries(item.severity_map).find(([, v]) => v === 0)?.[0] : null;

  if (item.response_type === "swatch") {
    return (
      <>
        <Kik item={item} />
        <div className="q">{item.prompt}</div>
        <div className="swatches">
          {item.options.map((o) => (
            <motion.button key={o} whileTap={{ scale: 0.95 }} transition={{ type: "spring", damping: 18, stiffness: 400 }}
              className={`swatch ${sel === o ? "sel" : ""}`} aria-label={o} aria-pressed={sel === o}
              onClick={() => { setSel(o); haptic(); onAnswer(o, null); }}>
              <i style={{ background: SWATCH[o] ?? "#ccc" }} /><span>{o}</span>
            </motion.button>
          ))}
        </div>
        <div className="swatch-scale"><span>well hydrated</span><span>dehydrated</span></div>
        <button className="skip" onClick={onSkip}>skip</button>
      </>
    );
  }

  if (item.response_type === "boolean" || item.response_type === "ordinal" || item.response_type === "chip") {
    const isChip = item.response_type === "chip";
    return (
      <>
        <Kik item={item} />
        <div className="q">{item.prompt}</div>
        <div className={isChip ? "chips" : "opts"}>
          {item.options.map((o) => (
            <motion.button key={o} whileTap={{ scale: 0.97 }} transition={{ type: "spring", damping: 18, stiffness: 400 }}
              className={isChip ? `chip ${sel === o ? "sel" : ""}` : `opt ${o === goodOption ? "good" : ""} ${sel === o ? "sel" : ""}`}
              onClick={() => { setSel(o); haptic(); onAnswer(o, null); }}>
              <span>{o}</span>{!isChip && <span className="k" />}
            </motion.button>
          ))}
        </div>
        <button className="skip" onClick={onSkip}>skip</button>
      </>
    );
  }

  if (item.response_type === "bodymap") {
    const toggle = (o: string) => setMulti((m) => (o === "None" ? [] : m.includes(o) ? m.filter((x) => x !== o) : [...m.filter((x) => x !== "None"), o]));
    return (
      <>
        <Kik item={item} />
        <div className="q">{item.prompt}</div>
        <div className="chips">
          {item.options.map((o) => (
            <motion.button key={o} whileTap={{ scale: 0.95 }} className={`chip ${multi.includes(o) ? "sel" : ""}`} onClick={() => toggle(o)}>{o}</motion.button>
          ))}
        </div>
        <div className="opts" style={{ marginTop: 20 }}>
          <motion.button className="opt sel" whileTap={{ scale: 0.97 }} onClick={() => onAnswer(multi.join(",") || "None", { regions: multi })}><span>Done</span></motion.button>
        </div>
        <button className="skip" onClick={onSkip}>skip</button>
      </>
    );
  }

  return (
    <>
      <Kik item={item} />
      <div className="q">{item.prompt}</div>
      <div className="chips">
        {item.options.map((o) => (
          <motion.button key={o} whileTap={{ scale: 0.95 }} transition={{ type: "spring", damping: 18, stiffness: 400 }}
            className={`chip ${sel === o ? "sel" : ""}`}
            onClick={() => { setSel(o); haptic(); onAnswer(o, { composition: o, at: new Date().toISOString() }); }}>{o}</motion.button>
        ))}
      </div>
      <button className="skip" onClick={onSkip}>skip</button>
    </>
  );
}

// The weekly review closes with a weigh-in — one number, feeds body-comp trends
// AND the bodyweight side of training load. Skipping is always fine.
// One weigh-in a day: `weight` is today's, fetched with the page, so this never loads
// on its own (a loading placeholder here shifted the buttons under it).
function WeighInPrompt({ weight, onSaved, onDone, autoFocus = true, note }: {
  weight: number | null; onSaved: (kg: number) => void; onDone: () => void; autoFocus?: boolean; note?: string;
}) {
  const [kg, setKg] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = parseFloat(kg);
    if (!Number.isFinite(v) || v < 20 || v > 300 || saving) return;
    setSaving(true);
    try { await db.saveMeasurement("weight", v, "kg"); haptic(); onSaved(v); onDone(); }
    catch { setSaving(false); }
  };
  if (weight != null) return <div className="done-note">Weight saved · {weight} kg</div>;
  return (
    <>
    {note && <div className="done-note">{note}</div>}
    <div className="wi-prompt" onClick={(e) => e.stopPropagation()}>
      <input type="number" inputMode="decimal" placeholder="weight kg" value={kg}
        onChange={(e) => setKg(e.target.value)} autoFocus={autoFocus} />
      <button className="logfood" style={{ flex: "none" }} onClick={submit} disabled={saving || !kg.trim()}>
        {saving ? "…" : "Save"}
      </button>
    </div>
    </>
  );
}

// Calories in and out for the day, one slim strip under the recovery card. No net figure on
// purpose: the eaten side reads low on any day a meal isn't logged (the weekly balance in
// Progress handles that). Nothing logged shows a dash, not "0", which would read as "ate nothing".
function EnergyStrip({ e, stale }: { e: DayEnergy; stale: boolean }) {
  const v = (n: number | null) => n ? <b className="es-v">{n.toLocaleString()}<i>kcal</i></b> : <b className="es-v">—</b>;
  return (
    <Link href="/food" className={`energy-strip${stale ? " stale" : ""}`}
      aria-label={`Eaten ${e.eaten ? `${e.eaten} kcal` : "nothing logged"}, burnt ${e.burned != null ? `${e.burned} kcal` : "unknown"}. Open Food`}>
      <div><span className="es-l">Eaten</span>{v(e.eaten)}</div>
      <div><span className="es-l">Burnt</span>{v(e.burned)}</div>
    </Link>
  );
}

// Stool: one tap when you go, picking the form. Count on the right, undo below.
// Grey until pressed, so it stays quieter than the check-in rows above it.

function StoolRow({ stool, editable, past, onChange }: {
  stool: body.Stool[]; editable: boolean; past: boolean; onChange: () => void | Promise<void>;
}) {
  const { shown, last, canUndo, add, undo } = useTapLog(stool, onChange);
  const lastTimed = [...shown].reverse().find((s) => s.logged_at);
  const label = (f: body.StoolForm) => body.STOOL_FORMS.find((x) => x.form === f)?.label.toLowerCase() ?? f;
  if (!editable && !shown.length) return null;
  return (
    <div className="tapcard home">
      <div className="tap-top">
        <div className="tap-l"><b>Stool</b>
          <span>{lastTimed ? `last at ${new Date(lastTimed.logged_at!).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ${label(lastTimed.form)}`
            : shown.length ? "logged, no time" : "tap when you go"}</span></div>
        <div className="tap-total">{shown.length}<i>{past ? "that day" : "today"}</i></div>
      </div>
      {editable && <>
        <div className="tap-btns forms">
          {body.STOOL_FORMS.map((f) => (
            <button key={f.form} className="tap-add" onClick={() => add(body.newStool(f.form), body.logStool)}>
              <span>{f.label}<i>{f.hint}</i></span>
            </button>
          ))}
        </div>
        {/* always laid out, so the card doesn't grow on the first tap */}
        <button className={`tap-undo pill${last ? "" : " off"}`} onClick={() => last && undo(last.id, body.deleteStool)} disabled={!canUndo} aria-hidden={!last}>
          <UndoIcon />{last ? `Undo last · ${label(last.form)}` : "Undo"}</button>
      </>}
    </div>
  );
}

// One quiet link to flag the day in view as travel, sick or rest.
function ContextLine({ context, onOpen }: { context: string; onOpen: () => void }) {
  const t = contextLinkText(context);
  return (
    <div className="notif">{t.lead && <>{t.lead} · </>}<button className="notif-a" onClick={onOpen}>{t.action}</button></div>
  );
}

function ContextSheet({ context, onClose, onPick }: { context: string; onClose: () => void; onPick: (c: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const pick = async (c: string) => {
    if (busy) return;
    setBusy(true);
    try { await onPick(c); } catch (e) { console.error(e); setBusy(false); }
  };
  return (
    <motion.div className="sheet-bg" initial={{ backgroundColor: "rgba(0,0,0,0)" }} animate={{ backgroundColor: "rgba(0,0,0,0.55)" }}
      exit={{ backgroundColor: "rgba(0,0,0,0)" }} onClick={onClose}>
      <motion.div className="sheet scroll" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 320 }} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">What kind of day?</div>
        <div className="trows" style={{ marginTop: 0 }}>
          {CONTEXT_OPTIONS.map((o) => (
            <button key={o.id} className="trow ctx-opt" disabled={busy} aria-pressed={context === o.id} onClick={() => pick(o.id)}>
              <span>{o.label}<small>{o.why}</small></span>
              {context === o.id && <span className="ctx-ck">✓</span>}
            </button>
          ))}
          <button className="trow ctx-opt" disabled={busy} aria-pressed={context === "normal"} onClick={() => pick("normal")}>
            <span>Normal day<small>Clears the flag</small></span>
            {context === "normal" && <span className="ctx-ck">✓</span>}
          </button>
        </div>
        <button className="sheet-cancel" onClick={onClose}>cancel</button>
      </motion.div>
    </motion.div>
  );
}

// One quiet line about reminders on this phone. When they're on it's just a link to
// your times; when the subscription has died (iOS drops them silently) it says so,
// with one tap to fix.
function RemindersLine({ onEdit }: { onEdit: () => void }) {
  const [st, setSt] = useState<PushState | "loading">("loading");
  useEffect(() => { pushState().then(setSt).catch(() => setSt("broken")); }, []);
  if (st === "loading") return null;
  const times = <> · <button className="notif-a" onClick={onEdit}>your times</button></>;
  if (st === "on" || st === "unsupported") return (
    <div className="notif">{st === "on" ? <span className="on">Reminders on</span> : "Reminders need the home-screen app"}{times}</div>
  );
  if (st === "broken") return (
    <div className="notif"><button className="notif-a warn" onClick={async () => setSt((await syncPush().catch(() => false)) ? "on" : "broken")}>
      Reminders off: not reaching this phone. Tap to fix →</button>{times}</div>
  );
  if (st === "not-installed") return <div className="notif">Reminders off · add CALIBEX to your home screen to get them{times}</div>;
  if (st === "denied") return <div className="notif">Reminders off · turn them on in iOS Settings › Notifications › CALIBEX{times}</div>;
  return (
    <div className="notif"><button className="notif-a" onClick={async () => {
      const r = await enablePush().catch(() => "error" as const);
      setSt(r === "ok" ? "on" : r === "error" ? "broken" : r);
    }}>Reminders off · turn on →</button>{times}</div>
  );
}

function HomeSkeleton() {
  return (
    <main className="app">
      <div className="body">
        <div className="topbar">
          <span className="brand"><span className="logomark" aria-hidden />CALIBEX</span>
          <span className="sk" style={{ width: 84, height: 11, borderRadius: 5 }} />
        </div>
        <div className="hero">
          <span className="sk" style={{ display: "block", width: 132, height: 11, borderRadius: 5 }} />
          <span className="sk" style={{ display: "block", width: 168, height: 72, borderRadius: 16, margin: "16px 0 6px" }} />
          <span className="sk" style={{ display: "block", width: "100%", height: 48, borderRadius: 10, margin: "18px 0 4px" }} />
          <div className="vitals">
            {[0, 1, 2, 3, 4].map((i) => (
              <div className="vital" key={i}>
                <span className="sk" style={{ display: "block", width: 40, height: 26, borderRadius: 7, margin: "0 auto" }} />
              </div>
            ))}
          </div>
        </div>
        <div className="energy-strip" aria-hidden>
          {[0, 1].map((i) => <div key={i}><span className="sk" style={{ width: 96, height: 14, borderRadius: 5, alignSelf: "center" }} /></div>)}
        </div>
        <div className="sec-h"><span>Today</span><span className="sk" style={{ width: 40, height: 10, borderRadius: 5 }} /></div>
        <div className="rows">
          {[0, 1, 2, 3, 4].map((i) => (
            <div className="row" key={i}>
              <span className="sk" style={{ width: 96 + (i % 3) * 28, height: 14, borderRadius: 6 }} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function Sparkline({ data }: { data: { wake_date: string; recovery_score: number | null }[] }) {
  // Press-and-hold reads a day: the caption turns into that day's score and a dot
  // marks it. Release goes back to the caption. A vertical scroll cancels.
  const [held, setHeld] = useState<number | null>(null);
  // Oldest → newest so a single continuous line reads left-to-right and bridges any
  // missing days (filter() returns a fresh array, so sort() doesn't touch state).
  const rows = data.filter((d) => d.recovery_score != null)
    .sort((a, b) => a.wake_date.localeCompare(b.wake_date));
  if (rows.length < 2) return <div className="spark" />;
  const vals = rows.map((r) => r.recovery_score as number);
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const W = 320, H = 48;
  // Position x by actual date (not array index) so gaps show honestly and the axis labels line up.
  const ms = (d: string) => new Date(d + "T12:00:00").getTime();
  const t0 = ms(rows[0].wake_date), span = ms(rows[rows.length - 1].wake_date) - t0 || 1;
  const pts = rows.map((r) => {
    const x = ((ms(r.wake_date) - t0) / span) * W;
    const y = H - (((r.recovery_score as number) - min) / range) * (H - 10) - 5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1].split(",");
  const mid = Math.floor((rows.length - 1) / 2);
  const xs = rows.map((r) => ((ms(r.wake_date) - t0) / span) * W);
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    e.stopPropagation(); // the hero card tilts on pointermove; keep it still while reading
    const b = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - b.left) / (b.width || 1)) * W;
    let best = 0;
    xs.forEach((x, k) => { if (Math.abs(x - px) < Math.abs(xs[best] - px)) best = k; });
    setHeld(best);
  };
  const hp = held != null && rows[held] ? pts[held].split(",") : null;
  return (
    <>
      <div className="spark-cap">{hp
        ? <><b>{Math.round(rows[held!].recovery_score as number)}%</b> · {rows[held!].wake_date === wakeDate() ? "today" : fmtAxis(rows[held!].wake_date)}</>
        : "14-day recovery trend"}</div>
      {/* One solid polyline, always fully drawn (fade the whole SVG in, never the path —
          pathLength draw-ins on a polyline fragment on re-render). Aliveness = the pulsing tip. */}
      <motion.svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
        onPointerDown={pick} onPointerMove={(e) => { if (e.buttons || e.pointerType === "mouse") pick(e); }}
        onPointerUp={(e) => { if (e.pointerType !== "mouse") setHeld(null); }} onPointerCancel={() => setHeld(null)}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setHeld(null); }} onContextMenu={(e) => e.preventDefault()}>
        <defs>
          <linearGradient id="sg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8b93a8" /><stop offset="72%" stopColor="#caa24a" /><stop offset="100%" stopColor="#f5c451" />
          </linearGradient>
        </defs>
        <polyline fill="none" stroke="url(#sg)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
          points={pts.join(" ")} vectorEffect="non-scaling-stroke" />
        <motion.circle cx={last[0]} cy={last[1]} fill="#f5c451"
          style={{ filter: "drop-shadow(0 0 5px rgba(245,196,81,.85))" }}
          initial={{ r: 0 }} animate={{ r: [3.4, 4.6, 3.4] }}
          transition={{ r: { duration: 2.2, repeat: Infinity, ease: "easeInOut" }, delay: 0.7 }} />
        {hp && <>
          <line x1={hp[0]} x2={hp[0]} y1={0} y2={H} className="spark-cross" vectorEffect="non-scaling-stroke" />
          <circle cx={hp[0]} cy={hp[1]} r={3.6} className="spark-on" />
        </>}
      </motion.svg>
      <div className="spark-x">
        <span>{fmtAxis(rows[0].wake_date)}</span>
        <span>{fmtAxis(rows[mid].wake_date)}</span>
        <span className="now">{rows[rows.length - 1].wake_date === wakeDate() ? "today" : fmtAxis(rows[rows.length - 1].wake_date)}</span>
      </div>
    </>
  );
}

function fmtAxis(d: string) { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function fmtv(v: number | null | undefined) { return v != null ? Math.round(v) : "—"; }
function facetLabel(item: Item) { return (item.facet || item.dimension_id).replace(/_/g, " "); }
