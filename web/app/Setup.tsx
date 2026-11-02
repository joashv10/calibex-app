"use client";
import { useEffect, useState } from "react";
import { TimeField } from "./TimeField";
import { motion, AnimatePresence } from "motion/react";
import { clock, saveSettings, suggestTimes, toMin, type Settings } from "@/lib/settings";
import { enablePush } from "@/lib/push";

const EASE = [0.16, 1, 0.3, 1] as const;
const hhmm = (t: string | null | undefined) => (t ?? "").slice(0, 5);

type Times = { first_meal: string; lunch: string; dinner: string };

function TimeRows({ times, onChange }: { times: Times; onChange: (t: Times) => void }) {
  const rows: { k: keyof Times; l: string }[] = [
    { k: "first_meal", l: "First meal" },
    { k: "lunch", l: "Lunch" },
    { k: "dinner", l: "Dinner" },
  ];
  return (
    <div className="trows">
      {rows.map((r) => (
        <div className="trow" key={r.k}>
          <span>{r.l}</span>
          <TimeField value={times[r.k]} step={15} label={`${r.l} time`}
            onChange={(v) => onChange({ ...times, [r.k]: v })} />
        </div>
      ))}
    </div>
  );
}

// What CALIBEX will and won't do. Shown in setup and in the schedule sheet.
function Promise4({ times, wake }: { times: Times; wake: number | null }) {
  const plus30 = (t: string) => clock((toMin(t) ?? 0) + 30);
  return (
    <ul className="promise">
      <li><b>Morning</b><span>when WHOOP scores your sleep{wake != null ? ` (by ${clock(wake + 120)} at the latest)` : ""}</span></li>
      <li><b>Lunch</b><span>{plus30(times.lunch)}, 30 min in</span></li>
      <li><b>After a workout</b><span>when WHOOP scores it, once a day</span></li>
      <li><b>Dinner</b><span>{plus30(times.dinner)}, 30 min in</span></li>
    </ul>
  );
}

// First run: your meal times, then the reminder promise and the permission prompt.
// About 45 seconds. Replaces the old intro cards, which explained but set nothing.
export function Setup({ wake, name, onDone }: { wake: number | null; name: string | null; onDone: (s: Partial<Settings>) => void }) {
  const [step, setStep] = useState(0);
  const [times, setTimes] = useState<Times>(() => suggestTimes(wake));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const el = document.documentElement;
    el.classList.add("locked");
    window.scrollTo(0, 0);
    return () => el.classList.remove("locked");
  }, []);

  const finish = async (withPush: boolean) => {
    if (busy) return;
    setBusy(true);
    if (withPush) {
      // Setup must always finish: a push failure is fixable later from the Today line.
      const r = await enablePush().catch((e) => { console.error(e); return "error" as const; });
      if (r === "not-installed") { setNote("Add CALIBEX to your home screen first (Share › Add to Home Screen), then turn reminders on from Today."); setBusy(false); return; }
    }
    const patch: Partial<Settings> = {
      ...times, name: name ?? null, setup_done_at: new Date().toISOString(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
    };
    try { await saveSettings(patch); } catch (e) { console.error(e); }
    onDone(patch);
  };

  return (
    <motion.div className="onboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <AnimatePresence mode="wait">
        {step === 0 ? (
          <motion.div key="t" className="ob-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.42, ease: EASE }}>
            <div className="ob-h">When do you usually eat?</div>
            <p className="ob-p">{wake != null
              ? <>WHOOP says you usually wake around <b className="mono">{clock(wake)}</b>. Your morning check-in follows your real wake-up each day.</>
              : <>Your morning check-in follows your real wake-up from WHOOP each day.</>}</p>
            <TimeRows times={times} onChange={setTimes} />
          </motion.div>
        ) : (
          <motion.div key="r" className="ob-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.42, ease: EASE }}>
            <div className="ob-h">Four reminders, at most.</div>
            <Promise4 times={times} wake={wake} />
            <p className="ob-p small">Each one opens its exact screen and stays quiet once you&apos;ve logged that moment. No streaks, no counts, no &ldquo;you missed&rdquo;.</p>
            {note && <p className="ob-note">{note}</p>}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="ob-foot">
        <div className="ob-dots">{[0, 1].map((n) => <i key={n} className={n === step ? "on" : ""} />)}</div>
        {step === 0
          ? <motion.button className="ob-btn" whileTap={{ scale: 0.97 }} onClick={() => setStep(1)}>Next</motion.button>
          : <motion.button className="ob-btn" whileTap={{ scale: 0.97 }} disabled={busy}
              onClick={() => (note ? finish(false) : finish(true))}>{note ? "Done" : busy ? "…" : "Turn on reminders"}</motion.button>}
        {step === 1 && !note && <button className="ob-skip" onClick={() => finish(false)}>not now</button>}
      </div>
    </motion.div>
  );
}

type Kind = "remind_morning" | "remind_lunch" | "remind_session" | "remind_dinner" | "remind_weekly";
const KINDS: { k: Kind; l: string }[] = [
  { k: "remind_morning", l: "Morning check-in" },
  { k: "remind_lunch", l: "Lunch" },
  { k: "remind_session", l: "After a workout" },
  { k: "remind_dinner", l: "Dinner" },
  { k: "remind_weekly", l: "Weekly review (Sunday 6pm)" },
];

// Later edits: times and each reminder's switch. Reached from the quiet line on Today.
export function ScheduleSheet({ settings, wake, onClose, onSaved }: {
  settings: Settings; wake: number | null; onClose: () => void; onSaved: (s: Partial<Settings>) => void;
}) {
  const [times, setTimes] = useState<Times>({
    first_meal: hhmm(settings.first_meal) || "12:00", lunch: hhmm(settings.lunch) || "14:30", dinner: hhmm(settings.dinner) || "21:00",
  });
  // remind_weekly is only present once migration 022 is applied; before that the row is hidden
  // and never saved, so a missing column can't fail the whole save.
  const hasWeekly = settings.remind_weekly !== undefined;
  const [on, setOn] = useState<Record<Kind, boolean>>({
    remind_morning: settings.remind_morning, remind_lunch: settings.remind_lunch,
    remind_session: settings.remind_session, remind_dinner: settings.remind_dinner,
    remind_weekly: settings.remind_weekly ?? true,
  });
  const [saving, setSaving] = useState(false);
  const plus30 = (t: string) => clock((toMin(t) ?? 0) + 30);
  const when = {
    remind_morning: `when WHOOP scores your sleep${wake != null ? `, by ${clock(wake + 120)}` : ""}`,
    remind_lunch: plus30(times.lunch),
    remind_session: "when WHOOP scores it, once a day",
    remind_dinner: plus30(times.dinner),
    remind_weekly: "Sundays, a one-minute review and weigh-in",
  };
  const save = async () => {
    setSaving(true);
    const { remind_weekly, ...rest } = on;
    const patch = { ...times, ...rest, ...(hasWeekly ? { remind_weekly } : {}) };
    try { await saveSettings(patch); onSaved(patch); onClose(); } catch (e) { console.error(e); setSaving(false); }
  };
  return (
    <motion.div className="sheet-bg" initial={{ backgroundColor: "rgba(0,0,0,0)" }} animate={{ backgroundColor: "rgba(0,0,0,0.55)" }}
      exit={{ backgroundColor: "rgba(0,0,0,0)" }} onClick={onClose}>
      <motion.div className="sheet scroll" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 320 }} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">Your times</div>
        <TimeRows times={times} onChange={setTimes} />
        <div className="sheet-sub">Reminders</div>
        <div className="trows">
          {KINDS.filter((r) => r.k !== "remind_weekly" || hasWeekly).map((r) => (
            <label className="trow" key={r.k}>
              <span>{r.l}<small>{when[r.k]}</small></span>
              <input type="checkbox" className="switch" checked={on[r.k]} onChange={(e) => setOn({ ...on, [r.k]: e.target.checked })} />
            </label>
          ))}
        </div>
        <p className="sheet-fine">Each stays quiet once you&apos;ve logged that moment.</p>
        <button className="logfood wide" onClick={save} disabled={saving}>{saving ? "…" : "Save"}</button>
        <button className="sheet-cancel" onClick={onClose}>cancel</button>
      </motion.div>
    </motion.div>
  );
}
