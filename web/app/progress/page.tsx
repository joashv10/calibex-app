"use client";
// Progress: how you're trending, four tiles under one range switch.
// Recovery (WHOOP vitals vs your normal), Training (load + sessions), Food
// (logged days only) and Body (weigh-ins). Descriptive: no claims live here.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureAuth, saveMeasurement } from "@/lib/data";
import { wakeDate } from "@/lib/day";
import { useOpenRequest } from "@/lib/deeplink";
import { fmtSteps, fmtStepsDelta } from "@/lib/steps";
import { getCycles, signed, type Cycle } from "@/lib/readout";
import { energyBalance, type Energy } from "@/lib/energy";
import { body, fetchTrendRows, food, RANGES, rangeDays, shortDate, training, vitals, type Range, type TrendRows } from "@/lib/trends";
import { Columns, Line } from "../charts";

const RKEY = "calibex_progress_range";
const C_STRENGTH = "#b98a28", C_CARDIO = "#5b8fe6"; // validated pair (dataviz, dark surface)
const int = (v: number) => Math.round(v).toLocaleString("en-US");

export default function ProgressPage() {
  const [loading, setLoading] = useState(true);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [rows, setRows] = useState<TrendRows | null>(null);
  // Remembered per device. Safe as initial state: the first render is "loading…" either way.
  const [range, setRange] = useState<Range>(() => {
    try { const r = Number(localStorage.getItem(RKEY)); if (r === 7 || r === 28 || r === 84) return r; } catch {}
    return 28;
  });
  const today = wakeDate();

  const load = useCallback(async () => {
    await ensureAuth();
    const [cy, tr] = await Promise.all([getCycles(), fetchTrendRows(wakeDate())]);
    setCycles(cy); setRows(tr);
    setLoading(false);
  }, []);
  useEffect(() => { load().catch((e) => { console.error(e); setLoading(false); }); }, [load]);

  const pick = (r: Range) => { setRange(r); try { localStorage.setItem(RKEY, String(r)); } catch {} };
  const days = useMemo(() => rangeDays(today, range), [today, range]);

  if (loading || !rows) return <div className="center">loading…</div>;

  return (
    <main className="app">
      <div className="body">
        <div className="topbar">
          <span style={{ width: 48 }} />
          <span className="brand"><span className="logomark" aria-hidden />PROGRESS</span>
          <span style={{ width: 48 }} />
        </div>
        <div className="seg" role="tablist" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.days} role="tab" aria-selected={range === r.days} className={range === r.days ? "on" : ""} onClick={() => pick(r.days)}>{r.label}</button>
          ))}
        </div>
        <Tiles cycles={cycles} rows={rows} days={days} onWeighed={load} />
      </div>
    </main>
  );
}

function Tiles({ cycles, rows, days, onWeighed }: { cycles: Cycle[]; rows: TrendRows; days: string[]; onWeighed: () => Promise<void> }) {
  const v = useMemo(() => vitals(cycles, days, wakeDate()), [cycles, days]);
  const b = useMemo(() => body(rows.weights, days), [rows, days]);
  const t = useMemo(() => training(rows, days, b.latest?.value ?? null), [rows, days, b.latest]);
  const f = useMemo(() => food(rows.food, days, rows.substances), [rows, days]);
  const e = useMemo(() => energyBalance(rows, wakeDate()), [rows]); // always the last 7 complete days
  return (
    <>
      <RecoveryTile v={v} days={days.length} />
      <TrainingTile t={t} />
      <FoodTile f={f} />
      <EnergyTile e={e} />
      <BodyTile b={b} days={days} onWeighed={onWeighed} />
    </>
  );
}

function RecoveryTile({ v, days }: { v: ReturnType<typeof vitals>; days: number }) {
  const [k, setK] = useState(0);
  const cur = v[k];
  const steps = (s: { key: string }) => s.key === "step_count";
  const fmt = steps(cur) ? fmtSteps : (x: number) => int(x);
  return (
    <>
      <div className="sec-h"><span>Recovery</span><span>vs your normal</span></div>
      <section className="pt">
        <div className={`pt-stats${v.length > 3 ? " four" : ""}`} role="tablist" aria-label="Measure">
          {v.map((s, i) => {
            const delta = s.avg != null && s.normal != null ? Math.round(s.avg - s.normal) : null;
            const good = delta == null || delta === 0 ? "" : (delta > 0) === (s.key !== "resting_heart_rate") ? "up" : "down";
            return (
              <button key={s.key} role="tab" aria-selected={i === k} className={`pt-stat${i === k ? " on" : ""}`} onClick={() => setK(i)}>
                <span>{s.label}</span>
                <b>{s.avg != null ? (steps(s) ? fmtSteps(s.avg) : int(s.avg)) : "—"}{!steps(s) && <i>{s.unit}</i>}</b>
                <em className={good}>{delta != null ? (steps(s) ? fmtStepsDelta(delta) : signed(delta)) : "no normal yet"}</em>
              </button>
            );
          })}
        </div>
        <Line points={cur.series} fmt={fmt} unit={cur.unit === "%" ? "%" : ` ${cur.unit}`} normal={cur.normal} name={cur.label} />
        {cur.n < days && <p className="pt-cap">{cur.n} of {days} days scored by WHOOP · gaps are days without a score</p>}
      </section>
    </>
  );
}

function TrainingTile({ t }: { t: ReturnType<typeof training> }) {
  const h = Math.floor(t.minutes / 60), m = t.minutes % 60;
  return (
    <>
      <div className="sec-h"><span>Training</span><span>{t.sessions} session{t.sessions === 1 ? "" : "s"} · {h ? `${h}h ` : ""}{m}m</span></div>
      <section className="pt">
        {t.bars.every((x) => x.strength + x.cardio === 0)
          ? <p className="pt-empty">No training load in this range.</p>
          : <Columns name={t.daily ? "Load per day" : "Load per week"} bars={t.bars.map((x) => ({ key: x.key, label: t.daily ? x.label : `wk of ${x.label}`, values: [x.strength, x.cardio] }))}
              names={["Strength", "Cardio"]} colors={[C_STRENGTH, C_CARDIO]} fmt={int} unit=" load" />}
        <p className="pt-cap">{t.daily ? "per day" : "per week"} · strength from your logged sets{t.strengthDays ? ` (${t.strengthDays} day${t.strengthDays === 1 ? "" : "s"})` : ""}, cardio from WHOOP heart rate</p>
      </section>
    </>
  );
}

function FoodTile({ f }: { f: ReturnType<typeof food> }) {
  if (f.loggedDays === 0) {
    return (
      <>
        <div className="sec-h"><span>Food</span></div>
        <section className="pt">
          <p className="pt-empty">Calories and protein show here once you log meals.</p>
          <Link href="/food" className="pt-link">Food<span aria-hidden>›</span></Link>
        </section>
      </>
    );
  }
  return (
    <>
      <div className="sec-h"><span>Food</span><span>{f.loggedDays} logged day{f.loggedDays === 1 ? "" : "s"}</span></div>
      <section className="pt">
        <div className="pt-stats two">
          <div className="pt-stat"><span>Calories</span><b>{f.kcal != null ? int(f.kcal) : "—"}<i>kcal</i></b><em>a logged day</em></div>
          <div className="pt-stat"><span>Protein</span><b>{f.protein != null ? int(f.protein) : "—"}<i>g</i></b><em>a logged day</em></div>
        </div>
        <Columns name="Calories" bars={f.points.map((p) => ({
          key: p.key, label: f.daily ? p.label : `wk of ${p.label}`, values: [p.value ?? 0], missing: p.value == null,
          dim: !f.daily && (p.n ?? 0) < 4, note: p.value == null ? "not logged" : f.daily ? undefined : `${p.n} of ${p.of} days logged`,
        }))} names={["Calories"]} colors={["var(--gold)"]} fmt={int} unit=" kcal" />
        <p className="pt-cap">{f.daily ? "per logged day" : "average per logged day, by week"} · unlogged days are left out, not counted as zero</p>
      </section>
    </>
  );
}


const balWord = (v: number) => (v > 0 ? "surplus" : v < 0 ? "deficit" : "level");

// Eaten vs WHOOP burn over the last 7 complete days. One day is noisy (burn depends on how long
// that cycle ran), so it shows only when 5 of 7 days are fully logged, else says what's missing.
function EnergyTile({ e }: { e: Energy }) {
  const head = <div className="sec-h"><span>Energy</span><span>last 7 full days</span></div>;
  if (e.gated || e.eatenAvg == null || e.burnAvg == null || e.diffAvg == null) {
    return (
      <>
        {head}
        <section className="pt">
          <p className="pt-empty">Needs 5 fully logged days in the last 7 (you have {e.logged}).</p>
          <p className="pt-cap">Breakfast, lunch and dinner each logged or skipped, plus a WHOOP burn for the day.</p>
        </section>
      </>
    );
  }
  const under = e.diffAvg < 0;
  const gap = e.diffAvg === 0 ? "about level with your burn" : `\u2248${int(Math.abs(e.diffAvg))} kcal/day ${under ? "under" : "over"} your burn`;
  // Both sides are estimates: the gap is usually smaller than WHOOP's own error, so frame it as rough.
  const caveat = "Both sides are estimates: the food reader errs low, and wrist trackers' burn is often off by 20% or more. Treat the gap as rough; the scale check is the better judge.";
  const sc = e.scale;
  return (
    <>
      {head}
      <section className="pt">
        <div className="pt-stats two">
          <div className="pt-stat"><span>Eaten</span><b>{int(e.eatenAvg)}<i>kcal</i></b><em>a day</em></div>
          <div className="pt-stat"><span>WHOOP burn</span><b>{int(e.burnAvg)}<i>kcal</i></b><em>a day</em></div>
        </div>
        <p className="en-gap">{gap}</p>
        <p className="pt-cap">Average of {e.logged} fully logged days; today isn’t counted. {caveat}</p>
        <p className="en-scale">
          {sc.open
            ? <>Scale: <b>≈{int(Math.abs(sc.scalePerDay))} ± {int(sc.scaleRange)} kcal/day</b> {balWord(sc.scalePerDay)} · Log: <b>≈{int(Math.abs(sc.logPerDay))} kcal/day</b> {balWord(sc.logPerDay)} <span>({shortDate(sc.from)} to {shortDate(sc.to)}; the ± assumes weigh-ins swing about 0.5 kg day to day)</span></>
            : "Scale check needs two weigh-ins 2+ weeks apart with most days logged."}
        </p>
      </section>
    </>
  );
}

// Weigh-ins on a day axis (latest reading wins on a day), so spacing shows real time.
function byDay(points: ReturnType<typeof body>["points"], days: string[]) {
  const on = new Map(points.map((p) => [p.wake_date, p.value]));
  return days.map((d) => ({ key: d, label: shortDate(d), value: on.get(d) ?? null }));
}

function BodyTile({ b, days, onWeighed }: { b: ReturnType<typeof body>; days: string[]; onWeighed: () => Promise<void> }) {
  // /progress?weigh=1 (Training's "weigh-in is N days old") → straight to an open input.
  // The tile mounts after data loads, so the request is already readable on first render.
  const { value: weighReq, consume: consumeWeigh } = useOpenRequest("/progress", "weigh");
  const [open, setOpen] = useState(() => weighReq != null);
  const [kg, setKg] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!weighReq) return;
    consumeWeigh();
    ref.current?.scrollIntoView({ block: "center" });
  }, [weighReq, consumeWeigh]);
  const save = async () => {
    const v = parseFloat(kg);
    if (!Number.isFinite(v) || v < 20 || v > 300 || saving) return;
    setSaving(true);
    try { await saveMeasurement("weight", v, "kg"); setKg(""); setOpen(false); await onWeighed(); } finally { setSaving(false); }
  };
  return (
    <>
      <div className="sec-h"><span>Body</span><span>{b.latest ? `last weighed ${shortDate(b.latest.wake_date)}` : ""}</span></div>
      <section className="pt" ref={ref}>
        {b.points.length >= 2
          ? <Line points={byDay(b.points, days)} bridge fmt={(x) => x.toFixed(1)} unit=" kg" name="Weight" />
          : b.latest
            ? <div className="pt-big"><b>{b.latest.value}</b><i>kg</i></div>
            : <p className="pt-empty">No weigh-ins yet.</p>}
        {b.points.length < 2 && b.latest && <p className="pt-cap">a trend line appears after two weigh-ins in this range</p>}
        {open ? (
          <div className="weighin pt-weigh">
            <input className="finput grams" type="number" inputMode="decimal" placeholder="kg" autoFocus
              value={kg} onChange={(e) => setKg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
            <button className="wi-log" onClick={save} disabled={saving || !kg.trim()}>{saving ? "…" : "Save"}</button>
          </div>
        ) : (
          <button className="pt-link" onClick={() => setOpen(true)}>Log weigh-in<span aria-hidden>›</span></button>
        )}
        <p className="pt-cap">weekly, same time of day, fasted. Your latest weight also sets bodyweight exercises in training load.</p>
      </section>
    </>
  );
}
