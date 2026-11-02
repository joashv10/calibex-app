"use client";
// Insights: what your data says about you, kept off Today so Today stays about logging.
// Top to bottom: gated findings, the tests still filling, descriptive patterns
// from WHOOP history (spreads and averages, never causes), then each day next to
// the recovery it produced.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureAuth } from "@/lib/data";
import { dayWord, setLogDay, wakeDate } from "@/lib/day";
import { addDays, dayFacts, fetchCycles, getDrinkRows, getExcludedDays, getTimeline, normalBefore, signed, type Cycle, type DayLine } from "@/lib/readout";
import { cachedSettings, getSettings } from "@/lib/settings";
import { drinkStatus, excludeDays, pendingTests, runH0, type DrinkRows, type Finding, type Pending } from "@/lib/stats";
import { bedtimes, clockFromEvening, fetchTestingRows, hrvTrend, recoveryByMonth, testingInputs, type FoodRow, type SubstanceRow } from "@/lib/trends";
import { Columns, DotStrip, Line } from "../charts";
import Link from "next/link";
import { Hero, LoadError, StaleNote, Strip, useBodyClock, WeekLine } from "./BodyClockParts";

export default function InsightsPage() {
  const [loading, setLoading] = useState(true);
  const [cyclesFailed, setCyclesFailed] = useState(false);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [timeline, setTimeline] = useState<DayLine[]>([]);
  const [skipDays, setSkipDays] = useState<string[]>([]);
  const [drinkRows, setDrinkRows] = useState<DrinkRows>({ journal: [], al1: [], substances: [] });
  const [logs, setLogs] = useState<{ food: FoodRow[]; substances: SubstanceRow[] }>({ food: [], substances: [] });
  const [tz, setTz] = useState(() => cachedSettings()?.tz || "Asia/Kolkata");
  const [dinner, setDinner] = useState<string | null>(() => cachedSettings()?.dinner ?? null);

  const load = useCallback(async () => {
    await ensureAuth();
    let ok = true;
    const [cy, tl, se, lg, sk, dr] = await Promise.all([fetchCycles().catch((e) => { console.error(e); ok = false; return [] as Cycle[]; }), getTimeline(wakeDate(), 14), getSettings(), fetchTestingRows(), getExcludedDays(), getDrinkRows()]);
    setCyclesFailed(!ok); setCycles(cy); setSkipDays(sk); setTimeline(tl); setLogs(lg); setDrinkRows(dr);
    if (se?.tz) setTz(se.tz);
    if (se) setDinner(se.dinner);
    setLoading(false);
  }, []);
  useEffect(() => { load().catch((e) => { console.error(e); setLoading(false); }); }, [load]);

  // Travel and sick days (and today's partial steps/strain) stay out of every test.
  // The sleep tests also need each night's drinking status (journal, AL1, Food).
  const drinks = useMemo(() => drinkStatus(drinkRows), [drinkRows]);
  const findings = useMemo(() => (cycles.length ? runH0(excludeDays(cycles, skipDays, wakeDate()), tz, drinks) : []), [cycles, skipDays, tz, drinks]);
  const pending = useMemo(() => pendingTests({ cycles, ...testingInputs(logs.food, logs.substances, tz, dinner) }), [cycles, logs, tz, dinner]);
  const [how, setHow] = useState(false);

  if (loading) return <div className="center">loading…</div>;

  return (
    <main className="app">
      <div className="body">
        <div className="topbar">
          <span style={{ width: 48 }} />
          <span className="brand"><span className="logomark" aria-hidden />INSIGHTS</span>
          <span style={{ width: 48 }} />
        </div>
        <BodyClockCard cycles={cycles} tz={tz} failed={cyclesFailed} />
        <Findings findings={findings} />
        <Testing pending={pending} />
        <Patterns cycles={cycles} tz={tz} />
        <Readout timeline={timeline} cycles={cycles} today={wakeDate()} tz={tz} />
        <button className="fd-how" onClick={() => setHow(!how)} aria-expanded={how}>{how ? "hide" : "how this works"}</button>
        {how && <p className="fd-note">A result shows only once it&apos;s unlikely to be chance: about 30 days of data (days in a row are alike, so they count for less), at least 10 days in each group being compared, and an effect that points the same way across its whole likely range. Until then it stays under &ldquo;not clear yet&rdquo;.</p>}
      </div>
    </main>
  );
}

// Cause → effect in a few words; the number carries the rest.
const SHORT: Record<Finding["id"], [string, string]> = {
  H0a1: ["Harder day", "next-morning recovery"],
  H0a2: ["Harder day", "recovery two days on"],
  H0d: ["Fewer steps", "next-morning recovery"],
  "H2a-earlier-recovery": ["Asleep 1 h+ earlier", "recovery"],
  "H2a-later-recovery": ["Asleep 1 h+ later", "recovery"],
  "H2a-earlier-hrv": ["Asleep 1 h+ earlier", "HRV that night"],
  "H2a-later-hrv": ["Asleep 1 h+ later", "HRV that night"],
  "H2a-earlier-rhr": ["Asleep 1 h+ earlier", "resting heart rate"],
  "H2a-later-rhr": ["Asleep 1 h+ later", "resting heart rate"],
  "H2b-recovery": ["Irregular sleep", "recovery"],
  "H2b-hrv": ["Irregular sleep", "HRV that night"],
  "H2b-rhr": ["Irregular sleep", "resting heart rate"],
};
const UNIT_SHORT: Record<Finding["unit"], string> = { "recovery points": "pts", "ms HRV": "ms", bpm: "bpm" };

// Every registered test, each behind the same gate. Only results that cleared it get a line;
// the rest fold into one quiet "still testing" row.
function Findings({ findings }: { findings: Finding[] }) {
  const [open, setOpen] = useState(false);
  if (!findings.length) return null;
  const pass = findings.filter((f) => f.status === "pass");
  const rest = findings.filter((f) => f.status !== "pass");
  return (
    <>
      <div className="sec-h"><span>What moves your recovery</span></div>
      <div className="fd">
        {pass.map((f) => (
          <div key={f.id} className="fd-row pass">
            <div className="fd-l"><span>{SHORT[f.id][0]}</span><i>→ {SHORT[f.id][1]}</i></div>
            <div className="fd-v"><b>{signed(Math.round(f.effect ?? 0))}</b><span>{UNIT_SHORT[f.unit]}</span></div>
          </div>
        ))}
        {!pass.length && <div className="fd-row"><div className="fd-l"><span>Nothing clear yet</span></div></div>}
        {rest.length > 0 && (
          <button className="fd-more" onClick={() => setOpen(!open)} aria-expanded={open}>
            {rest.length} not clear yet <span>{open ? "−" : "+"}</span>
          </button>
        )}
        {open && rest.map((f) => (
          <div key={f.id} className="fd-row quiet">
            <div className="fd-l"><span>{SHORT[f.id][0]}</span><i>→ {SHORT[f.id][1]}</i></div>
            <div className="fd-s">{f.status === "unclear" ? "enough data, no clear effect" : f.progress.replace("effective days", "days of data")}</div>
          </div>
        ))}
      </div>
    </>
  );
}

// Tests that need your logs. Each side fills as you log; no number shows until both are full.
function Testing({ pending }: { pending: Pending[] }) {
  return (
    <>
      <div className="sec-h"><span>Testing next</span><span>10 days each side to start</span></div>
      <div className="fd">
        {pending.map((p) => (
          <div key={p.id} className="fd-row tn">
            <div className="fd-l"><span>{p.cause}</span><i>→ {p.effect}</i></div>
            <div className="tn-arms">
              {p.arms.map((a) => (
                <div key={a.label} className="tn-arm">
                  <span>{a.label}</span>
                  <div className="tn-bar" role="meter" aria-valuemin={0} aria-valuemax={p.need} aria-valuenow={Math.min(a.have, p.need)} aria-label={`${a.label}: ${a.have} of ${p.need}`}>
                    <i style={{ width: `${Math.min(100, (a.have / p.need) * 100)}%` }} />
                  </div>
                  <b>{Math.min(a.have, p.need)}/{p.need}</b>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// Summary of the Body clock: regularity, the week line and the 7-night strip.
// Everything else is on the screen it links to.
function BodyClockCard({ cycles, tz, failed }: { cycles: Cycle[]; tz: string; failed: boolean }) {
  const bc = useBodyClock(cycles, tz);
  if (failed) return (<><div className="sec-h"><span>Body clock</span></div><section className="pt bc"><LoadError /></section></>);
  if (!bc) return null;
  return (
    <>
      <div className="sec-h"><span>Body clock</span></div>
      <section className="pt bc">
        <Hero bc={bc} />
        <WeekLine bc={bc} />
        <StaleNote cycles={cycles} tz={tz} />
        {bc.thisWeek.value !== null && <Strip nights={bc.strip} />}
        <Link href="/insights/body-clock" className="pt-link">Body clock<span aria-hidden>›</span></Link>
      </section>
    </>
  );
}

// Descriptive patterns from WHOOP history. Trends and spreads only.
function Patterns({ cycles, tz }: { cycles: Cycle[]; tz: string }) {
  const today = wakeDate();
  const hrv = useMemo(() => hrvTrend(cycles, today, 90), [cycles, today]);
  const bed = useMemo(() => bedtimes(cycles, today, tz, 30), [cycles, today, tz]);
  const months = useMemo(() => recoveryByMonth(cycles).slice(-12), [cycles]);
  const scored = cycles.filter((c) => c.recovery_score != null).length;
  if (!scored) return null;
  const spread = bed.q1 != null && bed.q3 != null ? Math.round(bed.q3 - bed.q1) : null;
  return (
    <>
      <div className="sec-h"><span>Your patterns</span><span>averages, not causes</span></div>
      {hrv.rolling.some((p) => p.value != null) && (
        <section className="pt">
          <div className="pt-h">HRV, last 90 days</div>
          <Line points={hrv.rolling} under={hrv.daily} underName="that night" fmt={(x) => String(Math.round(x))} unit=" ms" name="HRV 30-day average" />
          <p className="pt-cap">line: 30-day average · dots: each night</p>
        </section>
      )}
      {bed.n >= 7 && (
        <section className="pt">
          <div className="pt-h">Bedtime, last 30 nights</div>
          <DotStrip points={bed.points} q1={bed.q1} q3={bed.q3} median={bed.median} fmt={clockFromEvening} name="Bedtimes" />
          <p className="pt-cap">{spread != null ? `half your nights fall within ${spread} min of each other · ` : ""}shaded: the middle half · {bed.n} nights</p>
        </section>
      )}
      {months.length >= 2 && (
        <section className="pt">
          <div className="pt-h">Recovery by month</div>
          <Columns name="Average recovery" bars={months.map((m) => ({
            key: m.key, label: m.label, values: [m.value ?? 0], dim: (m.n ?? 0) < 10, note: `${m.n} of ${m.of} days scored`,
          }))} names={["Recovery"]} colors={["var(--gold)"]} fmt={(x) => String(Math.round(x))} unit="%" />
          <p className="pt-cap">average recovery · {scored} WHOOP days · faded: under 10 that month</p>
        </section>
      )}
    </>
  );
}

// Each day's behaviour next to the recovery it produced the next morning.
// Tapping a day opens it on Today.
function Readout({ timeline, cycles, today, tz }: { timeline: DayLine[]; cycles: Cycle[]; today: string; tz: string }) {
  const router = useRouter();
  const byDay = new Map(cycles.map((c) => [c.wake_date, c]));
  if (!timeline.length) return null;
  return (
    <>
      <div className="sec-h"><span>What you did → how you woke up</span></div>
      <p className="ro-cap">Woke up is WHOOP recovery the next morning; the small number is how far that sat above (+) or below (−) your usual.</p>
      <div className="ro">
        <div className="ro-row ro-head" aria-hidden><span>Day</span><span>What you did</span><span>Woke up</span></div>
        {timeline.map((d) => {
          const next = byDay.get(addDays(d.day, 1));
          const rec = next?.recovery_score ?? null;
          const n = rec != null ? normalBefore(cycles, addDays(d.day, 1), "recovery_score") : null;
          const facts = dayFacts(d, tz);
          return (
            <button key={d.day} className="ro-row" onClick={() => { setLogDay(d.day === today ? null : d.day); router.push("/"); }}>
              <span className="ro-d">{d.day === today ? "Today" : dayWord(d.day).replace(/^yesterday$/, "Yesterday")}</span>
              <span className={`ro-f${facts.length ? "" : " none"}`}>{facts.length ? facts.join(" · ") : "—"}</span>
              <span className="ro-r">{d.day === today ? <i>tomorrow</i>
                : rec == null ? <i>no data</i>
                : <><b>{Math.round(rec)}</b>{n != null && <em>{signed(Math.round(rec - n))}</em>}</>}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
