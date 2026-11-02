"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import * as tr from "@/lib/train";
import * as ex from "@/lib/exercises";
import { weightLabel } from "@/lib/weightLabel";
import * as ld from "@/lib/load";
import { ensureAuth } from "@/lib/data";
import { keyboardUp, pinnedSheet, useVisibleViewport } from "@/lib/viewport";
import { canEdit, dayWord, setLogDay, useLogDay, wakeDate, yesterdayDate } from "@/lib/day";
import DayPicker, { ViewOnly } from "../DayPicker";

export default function TrainPage() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<tr.LiftEntry[]>([]);
  const [today, setToday] = useState<tr.WhoopWorkout[]>([]);
  const [recent, setRecent] = useState<tr.WorkoutCard[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [templates, setTemplates] = useState<tr.LiftTemplate[]>([]);
  const [loadSum, setLoadSum] = useState<ld.LoadSummary | null>(null);
  const [logging, setLogging] = useState(false);
  const day = useLogDay(); // the day in view
  const editable = canEdit(day); // older days are view-only

  const load = useCallback(async () => {
    await ensureAuth();
    const [e, t, r, fav, rec, tp, ls] = await Promise.all([
      tr.getTodayEntries(), tr.getTodayWorkouts(), tr.getRecentWorkouts(),
      tr.getFavorites(), tr.getRecents(12), tr.getTemplates(),
      ld.getLoadSummary().catch(() => null),
    ]);
    setEntries(e); setToday(t); setRecent(r); setFavorites(fav); setRecents(rec); setTemplates(tp); setLoadSum(ls);
    setLoading(false);
  }, []);
  useEffect(() => { load().catch((err) => { console.error(err); setLoading(false); }); }, [load, day]);

  if (loading) return <div className="center">loading…</div>;

  const volume = entries.reduce((t, e) => t + tr.entryVolume(e), 0);
  const sets = entries.reduce((t, e) => t + e.sets.length, 0);
  // One card per session, each paired with its WHOOP strength workout (tr.pairWhoop), so a
  // gym visit reads as one thing ("Back Day · 70 min · strain 16.3"), not two.
  const sessions = tr.groupSessions(entries);
  const strengthW = today.filter((w) => tr.STRENGTH_SPORTS.has(w.sport_name));
  const pairedW = tr.pairWhoop(sessions, strengthW, day);
  const otherW = today.filter((w) => !pairedW.includes(w));
  const sessionLabel = day === wakeDate() ? "Today's session" : day === yesterdayDate() ? "Yesterday's session" : `Session · ${dayWord(day)}`;

  return (
    <main className="app">
      <div className="body">
        <div className="topbar">
          <Link href="/" className="back">‹ Today</Link>
          <span className="brand"><span className="logomark" aria-hidden />TRAINING</span>
          <DayPicker />
        </div>

        {loadSum && <LoadCard s={loadSum} />}

        {editable ? <button className="foodadd" onClick={() => setLogging(true)}>+ Log workout</button> : <ViewOnly />}

        <div className="sec-h">
          <span>{sessionLabel}</span>
          <span>{entries.length ? `${sets} sets${volume ? ` · ${Math.round(volume).toLocaleString()}kg` : ""}` : ""}</span>
        </div>
        {entries.length === 0 ? (
          <div className="empty">{editable
            ? <>No lifts yet. Tap <b>+ Log workout</b> — pick from your staples, a saved routine, or search 675 exercises; each one remembers last session&apos;s sets.</>
            : "No lifts logged."}</div>
        ) : (
          <div className="flog">
            {sessions.map((sn, i) => (
              <SessionCard key={sn.name} s={sn} whoop={pairedW[i] ?? null} day={day} editable={editable} onChanged={load} />
            ))}
          </div>
        )}

        {otherW.length > 0 && (
          <>
            <div className="sec-h"><span>From WHOOP {dayWord(day)}</span></div>
            <div className="flog">{otherW.map((w) => (
              <WorkoutRow key={w.id} w={w}
                onAdd={editable && tr.STRENGTH_SPORTS.has(w.sport_name) ? () => setLogging(true) : undefined} />
            ))}</div>
          </>
        )}

        <div className="sec-h"><span>Recent workouts</span><span>tap to open the day</span></div>
        {recent.length === 0 ? (
          <div className="empty">Your workouts show up here: WHOOP activities automatically, strength sessions once you log them.</div>
        ) : (
          <div className="flog">{recent.map((c) => <RecentRow key={c.key} c={c} />)}</div>
        )}
      </div>

      <AnimatePresence>
        {logging && (
          <LogWorkout
            favorites={favorites} recents={recents} templates={templates}
            onClose={() => setLogging(false)}
            onLogged={() => { setLogging(false); load(); }}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

// Two legible channels — strength (from your sets) and cardio (from WHOOP HR) —
// each vs YOUR 28-day norm. Never one opaque merged score.
function LoadCard({ s }: { s: ld.LoadSummary }) {
  const [why, setWhy] = useState(false);
  const sub = (today: number, baseline: number | null, pct: number | null) => {
    if (baseline != null && today === 0) return <i>rest so far · normal {baseline}</i>;
    if (pct != null) return <i className={pct > 0 ? "up" : pct < 0 ? "dn" : ""}>{pct > 0 ? "+" : ""}{pct}% vs normal</i>;
    return null;
  };
  const strengthSub = sub(s.today.strength, s.baseline.strength, s.deltaPct.strength)
    ?? (s.strengthDaysSpan > 0 ? <i>learning your normal · day {Math.min(s.strengthDaysSpan, 28)}/28</i>
      : <i>starts with your first lift</i>);
  const cardioSub = sub(s.today.cardio, s.baseline.cardio, s.deltaPct.cardio) ?? <i>no recent cardio</i>;
  return (
    <div className="loadcard">
      <div className="lc-h"><span>Training load</span><span>{dayWord()}</span></div>
      <div className="lc-cells">
        <div className="lc-cell"><b>{s.today.strength}</b><span>lifting load</span>{strengthSub}</div>
        <div className="lc-cell"><b>{s.today.cardio}</b><span>cardio load</span>{cardioSub}</div>
      </div>
      {s.unifiedSd != null && (
        <div className="lc-uni">overall {s.unifiedSd >= 0 ? "+" : ""}{s.unifiedSd.toFixed(1)}σ vs normal</div>
      )}
      {s.bodyweightMissing && <Link href="/progress?weigh=1" className="lc-note lc-go">bodyweight sets not counted yet — log a weigh-in to include them ›</Link>}
      {!s.bodyweightMissing && s.bodyweightAgeDays != null && s.bodyweightAgeDays > 9 && (
        <Link href="/progress?weigh=1" className="lc-note lc-go">weigh-in is {s.bodyweightAgeDays} days old — log a new one ›</Link>
      )}
      <button type="button" className="lc-why" aria-expanded={why} aria-controls="lc-explain" onClick={() => setWhy((v) => !v)}>
        {why ? "hide explanation" : "what are these?"}
      </button>
      {why && (
        <div className="lc-explain" id="lc-explain">
          <p><b>Lifting load</b> scores your logged sets: reps × weight, counting more when the weight is heavy for you and close to failure.</p>
          <p><b>Cardio load</b> scores your time in each WHOOP heart-rate zone, gym sessions included, with harder zones counting up to 5×.</p>
          <p><b>Normal</b> is your average day over the last 28 days, rest days included. The two use different scales, so compare each only with its own normal.</p>
          {s.unifiedSd != null && <p><b>Overall</b> combines both loads into how far today sits above or below your usual day. Rest days pull your usual day down, so a normal training day reads above zero.</p>}
        </div>
      )}
    </div>
  );
}

function EntryRow({ e, onDel }: { e: tr.LiftEntry; onDel?: () => void }) {
  const meta = ex.exerciseById(e.exercise_id);
  const readout = tr.tonnage(e);
  const nm = ex.shortName(e.exercise_name);
  return (
    <div className="fitem">
      <div className="fmain">
        <b title={nm}>{nm}</b>
        <span>{tr.summarizeSets(e)}{meta?.pm[0] ? ` · ${meta.pm[0]}` : ""}</span>
      </div>
      <div className="fmac">{readout}</div>
      {onDel && <button className="fdel" onClick={onDel} aria-label="remove">✕</button>}
    </div>
  );
}

// A session collapses to one line ("Back Day · 5 exercises · 17 sets · 7,995 kg"); tap to
// see its exercises, and rename it there.
function SessionCard({ s, whoop, day, editable, onChanged }: {
  s: tr.Session; whoop: tr.WhoopWorkout | null; day: string; editable: boolean; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string | null>(null); // non-null while renaming
  const meta = [
    `${s.entries.length} exercise${s.entries.length === 1 ? "" : "s"}`, `${s.sets} sets`,
    s.volume ? `${Math.round(s.volume).toLocaleString()} kg` : null,
    whoop?.duration_minutes ? `${Math.round(whoop.duration_minutes)} min` : null,
  ].filter(Boolean).join(" · ");
  const saveName = async () => {
    const to = (name ?? "").trim();
    setName(null);
    if (to && to !== s.name) { await tr.renameSession(day, s.name, to).catch(console.error); onChanged(); }
  };
  return (
    <div className={`sesscard${open ? " open" : ""}`}>
      <button className="sess-h" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="fmain"><b>{s.name}</b><span>{meta}</span></span>
        <span className="fmac">{whoop?.strain_score != null ? `strain ${whoop.strain_score.toFixed(1)}` : ""}</span>
        <span className="sess-chev" aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="sess-body">
          {s.entries.map((e) => (
            <EntryRow key={e.entry_id} e={e} onDel={editable ? async () => { await tr.deleteEntry(e.entry_id); onChanged(); } : undefined} />
          ))}
          {editable && (name === null
            ? <button className="sess-rename" onClick={() => setName(s.name)}>rename session</button>
            : <input className="finput" value={name} autoFocus onChange={(e) => setName(e.target.value)}
                onBlur={saveName} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />)}
        </div>
      )}
    </div>
  );
}

// One row per recent workout: a strength session merged with its WHOOP strain, or a
// WHOOP activity on its own. Tapping jumps the whole app to that day.
function RecentRow({ c }: { c: tr.WorkoutCard }) {
  const w = c.whoop;
  const bits = [
    fmtD(c.day),
    w?.duration_minutes ? `${Math.round(w.duration_minutes)} min` : null,
    c.lifts ? `${c.lifts.sets} sets` : null,
    c.lifts?.volume ? `${Math.round(c.lifts.volume).toLocaleString()} kg` : null,
    !c.lifts && w ? tr.km(w) || null : null,
    w?.average_heart_rate ? `${w.average_heart_rate} bpm` : null,
  ].filter(Boolean);
  const right = w ? (!c.lifts && tr.pace(w)) || (w.strain_score != null ? `strain ${w.strain_score.toFixed(1)}` : "") : "";
  return (
    <button className={`fitem recent${c.lifts ? " session" : ""}`} onClick={() => { setLogDay(c.day); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
      <span className="fmain"><b>{c.title}</b><span>{bits.join(" · ")}</span></span>
      <span className="fmac">{right}</span>
    </button>
  );
}

// A WHOOP lifting session with no sets yet takes onAdd: tapping it opens the logger, and
// what you log pairs with it (tr.pairWhoop).
function WorkoutRow({ w, showDate, onAdd }: { w: tr.WhoopWorkout; showDate?: boolean; onAdd?: () => void }) {
  const p = tr.pace(w);
  const dist = tr.km(w);
  const bits = [
    showDate ? fmtD(w.wake_date) : null,
    w.duration_minutes ? `${Math.round(w.duration_minutes)} min` : null,
    dist || null,
    w.average_heart_rate ? `${w.average_heart_rate} bpm` : null,
  ].filter(Boolean);
  const right = <div className="fmac">{p ?? (w.strain_score != null ? `strain ${w.strain_score.toFixed(1)}` : "")}</div>;
  if (onAdd) return (
    <button type="button" className="fitem fitem-add" onClick={onAdd}>
      <span className="fmain">
        <b>{tr.titleCase(w.sport_name)}</b><span>{bits.join(" · ")}</span>
        <span className="fadd">Add the exercises you did<i aria-hidden>›</i></span>
      </span>
      <span className="fmac">{p ?? (w.strain_score != null ? `strain ${w.strain_score.toFixed(1)}` : "")}</span>
    </button>
  );
  return (
    <div className="fitem">
      <div className="fmain"><b>{tr.titleCase(w.sport_name)}</b><span>{bits.join(" · ")}</span></div>
      {right}
    </div>
  );
}

// ── workout builder ─────────────────────────────────────────────────────────
type WSet = { weight: string; reps: string; dur: string };
type WEntry = { key: string; ex: ex.Exercise; sets: WSet[]; last?: string };

const emptySet = (): WSet => ({ weight: "", reps: "", dur: "" });

// Parse a numeric field: preserve a legitimate 0, reject negatives / garbage /
// absurd magnitudes — one fat-finger must never poison the aggregates.
function num(v: string, max: number, int: boolean): number | null {
  const t = v.trim();
  if (t === "") return null;
  let n = int ? parseInt(t, 10) : parseFloat(t);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  if (int) n = Math.trunc(n);
  return n;
}


function LogWorkout({ favorites, recents, templates, onClose, onLogged }: {
  favorites: string[]; recents: string[]; templates: tr.LiftTemplate[];
  onClose: () => void; onLogged: () => void;
}) {
  const [entries, setEntries] = useState<WEntry[]>([]);
  const [picking, setPicking] = useState(true); // open straight into the picker
  const [saveTpl, setSaveTpl] = useState("");
  const [saveToId, setSaveToId] = useState<string | null>(null); // append to an existing routine
  const [newRoutine, setNewRoutine] = useState(false);
  const [routine, setRoutine] = useState<string | null>(null); // name of the routine this workout started from
  const [favs, setFavs] = useState<string[]>(favorites);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const submittingRef = useRef(false); // synchronous guard — beats a sub-frame double-tap
  const box = useVisibleViewport();
  const pin = pinnedSheet(box); // sit on top of the keyboard, not behind it
  const kb = keyboardUp(box); // typing kg / reps: the sets get the room, Log comes back with the keyboard down

  // Don't silently drop a half-built workout on a stray backdrop tap.
  const tryClose = () => {
    if (confirmDiscard) return;
    if (entries.length) setConfirmDiscard(true);
    else onClose();
  };

  const addExercise = useCallback(async (e: ex.Exercise) => {
    const prev = await tr.lastSession(e.id);
    const sets: WSet[] = prev
      ? prev.sets.map((s) => ({ weight: s.weight?.toString() ?? "", reps: s.reps?.toString() ?? "", dur: s.duration_sec?.toString() ?? "" }))
      : [emptySet()];
    setEntries((c) => [...c, { key: crypto.randomUUID(), ex: e, sets, last: prev ? tr.summarizeSets(prev) : undefined }]);
    setPicking(false);
  }, []);

  const loadTemplate = useCallback(async (t: tr.LiftTemplate) => {
    setRoutine((r) => r ?? t.name);
    for (const item of t.exercises) {
      const e = ex.exerciseById(item.id);
      if (e) await addExercise(e);
    }
    setPicking(false);
  }, [addExercise]);

  const updSet = (ei: number, si: number, k: keyof WSet, v: string) =>
    setEntries((c) => c.map((e, i) => i !== ei ? e : { ...e, sets: e.sets.map((s, j) => j === si ? { ...s, [k]: v } : s) }));
  const addSet = (ei: number) =>
    setEntries((c) => c.map((e, i) => i !== ei ? e : { ...e, sets: [...e.sets, { ...e.sets[e.sets.length - 1] }] }));
  const rmSet = (ei: number, si: number) =>
    setEntries((c) => c.map((e, i) => i !== ei ? e : { ...e, sets: e.sets.filter((_, j) => j !== si) }).filter((e) => e.sets.length));
  const rmEntry = (ei: number) => setEntries((c) => c.filter((_, i) => i !== ei));

  const toggleStar = async (id: string) => {
    const on = !favs.includes(id);
    setFavs((c) => on ? [...c, id] : c.filter((x) => x !== id));
    await tr.toggleFavorite(id, on);
  };

  const built = useMemo(() => entries.map((w) => ({
    exercise_id: w.ex.id, exercise_name: w.ex.name, tracking_type: w.ex.type,
    sets: w.sets.map((s) => ({
      weight: num(s.weight, 1000, false),
      reps: num(s.reps, 1000, true),
      duration_sec: num(s.dur, 86400, true),
    })).filter((s) => s.weight != null || s.reps != null || s.duration_sec != null),
  })).filter((e) => e.sets.length), [entries]);

  const logWorkout = async () => {
    if (!built.length || submittingRef.current) return; // guard the double-tap double-insert
    submittingRef.current = true; setSubmitting(true); setErr(null);
    try {
      // Session name: the routine it came from, else the routine it's being saved as, else
      // named from what it trained ("Back & shoulders").
      const name = routine
        ?? (saveToId ? templates.find((t) => t.id === saveToId)?.name : null)
        ?? (newRoutine && saveTpl.trim() ? saveTpl.trim() : null)
        ?? tr.autoSessionName(built);
      await tr.logEntries(built, name); // the precious write — atomic, no half-written sessions
    } catch {
      // nothing was written, so re-tapping is safe — surface the error and let them retry.
      setErr("Couldn't save — check your connection and try again.");
      submittingRef.current = false; setSubmitting(false);
      return;
    }
    // The workout is logged. Saving to a routine is a convenience and must NEVER
    // be able to trigger a re-log — keep it best-effort and non-fatal.
    try {
      const exMeta = entries.map((w) => ({ id: w.ex.id, name: w.ex.name, type: w.ex.type }));
      if (saveToId) await tr.addToTemplate(saveToId, exMeta);
      else if (newRoutine && saveTpl.trim()) await tr.saveTemplate(saveTpl.trim(), exMeta);
    } catch { /* the log already succeeded; routine save is optional */ }
    onLogged();
  };

  return (
    <motion.div className="sheet-bg" initial={{ backgroundColor: "rgba(0,0,0,0)", backdropFilter: "blur(0px)" }}
      animate={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)" }}
      exit={{ backgroundColor: "rgba(0,0,0,0)", backdropFilter: "blur(0px)" }} onClick={tryClose} style={pin.overlay}>
      <motion.div className="sheet logsheet" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 320 }} onClick={(e) => e.stopPropagation()}
        style={pin.sheet}>

        {picking ? (
          <Picker favs={favs} recents={recents} entries={entries} templates={templates}
            onPick={addExercise} onStar={toggleStar} onLoadTemplate={loadTemplate}
            onBack={entries.length ? () => setPicking(false) : onClose} />
        ) : (
          <>
            <div className="logscroll">
              <div className="sheet-h">Log workout</div>

              <div className="wexs">
                {entries.map((w, ei) => (
                  <div className="wex" key={w.key}>
                    <div className="wex-h">
                      <div className="nm">
                        <b>{ex.shortName(w.ex.name)}</b>
                        <span>{w.ex.pm[0] ?? ""}{w.ex.eq ? ` · ${w.ex.eq}` : ""}</span>
                        {w.last && <div className="last">last {w.last}</div>}
                      </div>
                      <button className="rmx" onClick={() => rmEntry(ei)} aria-label="remove exercise">✕</button>
                    </div>
                    {w.sets.map((s, si) => (
                      <Fragment key={si}>
                      {si === 0 && <SetHead type={w.ex.type} kg={weightLabel(w.ex)} />}
                      <SetRow n={si + 1} type={w.ex.type} s={s}
                        onChange={(k, v) => updSet(ei, si, k, v)}
                        onRemove={w.sets.length > 1 ? () => rmSet(ei, si) : undefined} />
                      </Fragment>
                    ))}
                    <button className="addset" onClick={() => addSet(ei)}>+ set</button>
                  </div>
                ))}
              </div>

              <button className="addex" onClick={() => setPicking(true)}>+ Add exercise</button>

              {entries.length > 0 && (
                <div className="saveto">
                  <div className="dishform-h">add to a routine</div>
                  <div className="chips" style={{ marginTop: 0 }}>
                    {templates.map((t) => (
                      <button key={t.id} className={`chip${saveToId === t.id ? " sel" : ""}`}
                        onClick={() => { setSaveToId(saveToId === t.id ? null : t.id); setNewRoutine(false); }}>
                        {saveToId === t.id ? "✓ " : ""}{t.name}
                      </button>
                    ))}
                    <button className={`chip${newRoutine ? " sel" : ""}`}
                      onClick={() => { setNewRoutine(!newRoutine); setSaveToId(null); }}>+ New routine</button>
                  </div>
                  {newRoutine && (
                    <input className="finput" style={{ marginTop: 10 }} placeholder="Routine name — e.g. Chest day"
                      value={saveTpl} onChange={(e) => setSaveTpl(e.target.value)} autoFocus />
                  )}
                </div>
              )}
            </div>

            {!kb && <div className="sheet-foot">
              {err && <div className="sheet-err" role="alert">{err}</div>}
              <button className="addbtn" onClick={logWorkout} disabled={!built.length || submitting}>
                {submitting ? "Saving…" : `Log workout${built.length ? ` · ${built.length}` : ""}`}
              </button>
              <button className="sheet-cancel" onClick={tryClose}>cancel</button>
            </div>}
          </>
        )}

        {confirmDiscard && (
          <div className="discard-bar" role="alertdialog" aria-label="Discard workout?">
            <span>Discard this workout?</span>
            <div className="discard-actions">
              <button className="discard-keep" onClick={() => setConfirmDiscard(false)}>Keep</button>
              <button className="discard-go" onClick={onClose}>Discard</button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// Column labels over the first set's boxes; same row skeleton as SetRow so they line up at any width.
function SetHead({ type, kg }: { type: ex.TrackingType; kg: string }) {
  return (
    <div className="setrow sethead" aria-hidden="true">
      <span className="sn" />
      <span className="field">
        {type === "hold" ? <span className="lb">sec</span> : <>
          <span className="lb">reps</span><span className="x-sp">×</span><span className="lb">{type === "bodyweight" ? "+kg" : kg}</span>
        </>}
      </span>
    </div>
  );
}

function SetRow({ n, type, s, onChange, onRemove }: {
  n: number; type: ex.TrackingType; s: WSet;
  onChange: (k: keyof WSet, v: string) => void; onRemove?: () => void;
}) {
  const e1 = type === "weight_reps" && s.weight && s.reps ? tr.est1rm(parseFloat(s.weight), parseInt(s.reps)) : null;
  return (
    <div className="setrow">
      <span className="sn">{n}</span>
      {type === "hold" ? (
        <span className="field">
          <input type="number" inputMode="numeric" placeholder="sec" value={s.dur} onChange={(e) => onChange("dur", e.target.value)} />
          <span>sec</span>
        </span>
      ) : (
        <>
          <span className="field">
            <input type="number" aria-label="reps" inputMode="numeric" placeholder="reps" value={s.reps} onChange={(e) => onChange("reps", e.target.value)} />
            <span>×</span>
            <input type="number" aria-label={type === "bodyweight" ? "added kg" : "kg"} inputMode="decimal" placeholder={type === "bodyweight" ? "+kg" : "kg"} value={s.weight} onChange={(e) => onChange("weight", e.target.value)} />
          </span>
          {e1 ? <span className="e1">e1RM {e1}</span> : null}
        </>
      )}
      {onRemove && <button className="x" onClick={onRemove} aria-label="remove set">✕</button>}
    </div>
  );
}

// ── exercise picker ─────────────────────────────────────────────────────────
function Picker({ favs, recents, entries, templates, onPick, onStar, onLoadTemplate, onBack }: {
  favs: string[]; recents: string[]; entries: WEntry[]; templates: tr.LiftTemplate[];
  onPick: (e: ex.Exercise) => void; onStar: (id: string) => void;
  onLoadTemplate: (t: tr.LiftTemplate) => void; onBack: () => void;
}) {
  const [q, setQ] = useState("");
  const [muscle, setMuscle] = useState<string | null>(null);
  const added = useMemo(() => new Set(entries.map((e) => e.ex.id)), [entries]);

  const searching = q.trim().length > 0 || muscle != null;
  const results = useMemo(() => searching ? ex.searchExercises(q, { muscle, limit: 60 }) : [], [q, muscle, searching]);
  const favExs = useMemo(() => favs.map(ex.exerciseById).filter((e): e is ex.Exercise => !!e), [favs]);
  const recentExs = useMemo(
    () => recents.map(ex.exerciseById).filter((e): e is ex.Exercise => !!e && !favs.includes(e.id)),
    [recents, favs]);

  const Row = (e: ex.Exercise) => {
    const fav = favs.includes(e.id);
    const isAdded = added.has(e.id);
    const nm = ex.shortName(e.name);
    return (
      <div className="prow" key={e.id}>
        <button className="ptap" onClick={() => onPick(e)} title={nm}
          aria-label={isAdded ? `${nm}, added — tap to add again` : `Add ${nm}`}>
          <span className="pn">
            <b>{nm}{isAdded ? " ✓" : ""}</b>
            <span>{[e.pm[0], e.eq, e.type === "hold" ? "hold" : e.type === "bodyweight" ? "bodyweight" : null].filter(Boolean).join(" · ")}</span>
          </span>
        </button>
        <button className={`star${fav ? " on" : ""}`} aria-pressed={fav}
          aria-label={fav ? `Unpin ${nm} from staples` : `Pin ${nm} to staples`}
          onClick={() => onStar(e.id)}>{fav ? "★" : "☆"}</button>
      </div>
    );
  };

  return (
    <div className="logscroll">
      <div className="pick-top">
        <button className="pback" onClick={onBack}>‹ back</button>
        <span className="ttl">Add exercise</span>
      </div>

      <input className="finput" placeholder="Search 675 exercises…" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />

      <div className="mfilter">
        {ex.MUSCLES.map((m) => (
          <button key={m} className={`mchip${muscle === m ? " sel" : ""}`} onClick={() => setMuscle(muscle === m ? null : m)}>{m}</button>
        ))}
      </div>

      {searching ? (
        results.length ? (
          <div className="pres">{results.map(Row)}</div>
        ) : <div className="pempty">No match. Try a different term or muscle.</div>
      ) : (
        <>
          {templates.length > 0 && (
            <>
              <div className="pgroup-h">routines</div>
              <div className="chips" style={{ marginTop: 0, marginBottom: 4 }}>
                {templates.map((t) => <button key={t.id} className="chip" onClick={() => onLoadTemplate(t)}>{t.name} +</button>)}
              </div>
            </>
          )}
          {recentExs.length > 0 && (
            <>
              <div className="pgroup-h">recent</div>
              <div className="pres">{recentExs.map(Row)}</div>
            </>
          )}
          <div className="pgroup-h">your staples</div>
          {favExs.length ? <div className="pres">{favExs.map(Row)}</div>
            : <div className="pempty">Star exercises to pin them here.</div>}
        </>
      )}
    </div>
  );
}

function fmtD(d: string) { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function fmtClock(iso: string) { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
