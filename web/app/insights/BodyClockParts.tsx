"use client";
// Body clock pieces shared by the Insights card and the full screen. All numbers
// come from lib/bodyClock (computed, never stored); below a minimum a figure shows
// what's missing instead of a number.
import { useMemo } from "react";
import { bodyClock, clockLabel, staleNote, wakeDateIn, type BodyClock, type Metric, type StripNight } from "@/lib/bodyClock";
import type { Cycle } from "@/lib/readout";
import { progressSentence, type Finding } from "@/lib/stats";

export function useBodyClock(cycles: Cycle[], tz: string): BodyClock | null {
  return useMemo(() => {
    const nights = cycles.filter((c) => c.sleep_start && c.sleep_end);
    if (!nights.length) return null;
    return bodyClock(nights, nights[nights.length - 1].wake_date, tz);
  }, [cycles, tz]);
}

// Quiet line when the newest night is older than yesterday's, so a stale week never reads as current.
// "Today" is read on the tz setting, not the device clock, like the rest of the Body clock.
export function StaleNote({ cycles, tz }: { cycles: Cycle[]; tz: string }) {
  const last = cycles.filter((c) => c.sleep_start && c.sleep_end).at(-1);
  const note = last ? staleNote(last.wake_date, wakeDateIn(tz)) : null;
  return note ? <p className="bc-sub">{note}</p> : null;
}

// Shown instead of the Body clock when WHOOP history could not be read (not "still learning").
export function LoadError() {
  return <p className="pt-empty">Couldn&apos;t load your sleep data. Pull to refresh or try again later.</p>;
}

const need = (m: Metric<unknown>, unit = "nights") => `needs ${m.need} ${m.of ?? unit}, have ${m.have}`;
const sgn = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(Math.round(n));
// 40 → "40 min", 132 → "2h 12m"
const dur = (min: number) => { const m = Math.round(min); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`; };

// "down from 81 last week" / "up from" / "same as"
function vsLastWeek(now: number, before: number | null): string | null {
  if (before === null) return null;
  return now === before ? `same as last week (${before})` : `${now < before ? "down" : "up"} from ${before} last week`;
}

export function Hero({ bc }: { bc: BodyClock }) {
  const r = bc.regularity.d28;
  if (r.value === null) {
    return (
      <>
        <div className="bc-k">Sleep regularity</div>
        <div className="bc-learn">Still learning</div>
        <p className="bc-sub">{need(r, "pairs of back-to-back nights")}</p>
      </>
    );
  }
  return (
    <>
      <div className="bc-k">Sleep regularity</div>
      <div className="bc-big"><b>{r.value < 0 ? `−${Math.abs(r.value)}` : r.value}</b><i>/ 100</i></div>
      {vsLastWeek(r.value, bc.regularity.d28WeekAgo.value) && <p className="bc-sub">{vsLastWeek(r.value, bc.regularity.d28WeekAgo.value)}</p>}
    </>
  );
}

export function WeekLine({ bc }: { bc: BodyClock }) {
  const t = bc.thisWeek, u = bc.usualWeek;
  if (t.value === null) return <p className="bc-sub">Still learning this week: {need(t)}.</p>;
  return (
    <div className="bc-wk">
      <div className="bc-wk-h"><span>This week</span>{bc.weekWord && <span className="bc-word">{bc.weekWord}</span>}</div>
      <p className="bc-week">
        Typical night <b>{dur(t.value)}</b> off your usual{u.value !== null ? <span className="nw"> · normally <b>{dur(u.value)}</b></span> : null}
      </p>
      {u.value === null && <p className="bc-sub">Usual week: {need(u, "weeks")}.</p>}
    </div>
  );
}

// Each dot: that night's middle of sleep against your usual (centre line). Clipped at ±150 min.
// Earlier is up, later is down. Room: dots reach mid ± 30, a clamped night's "+Nh" sits 16 below / 9 above,
// then a clear gap before the day letter at the foot. A one-line caption says how to read it.
// Labels are 14 units so they render at 11 px or more down to a 320 px screen (the strip is ~0.8 scale there).
export function Strip({ nights }: { nights: StripNight[] }) {
  const W = 300, H = 136, mid = 60, S = W / 7, clip = 150, k = 0.2;
  return (
    <>
    <svg className="bc-strip" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Last 7 nights against your usual: ${nights.map((n) => `${n.dow} ${n.dev == null ? "no data" : sgn(n.dev) + " min"}`).join(", ")}`}>
      <line x1={0} x2={W} y1={mid} y2={mid} className="bc-axis" />
      {nights.map((n, i) => {
        const cx = S * i + S / 2;
        const off = n.dev != null && Math.abs(n.dev) > clip;
        const cy = n.dev == null ? mid : mid + Math.max(-clip, Math.min(clip, n.dev)) * k;
        return (
          <g key={n.date}>
            {n.dev != null && <line x1={cx} x2={cx} y1={mid} y2={cy} className="bc-stem" />}
            {n.dev != null && <circle cx={cx} cy={cy} r={4} className={off ? "bc-dot off" : "bc-dot"} />}
            {off && <text x={cx} y={cy + (n.dev! > 0 ? 16 : -9)} textAnchor="middle" className="bc-t">{sgn(n.dev! / 60)}h</text>}
            <text x={cx} y={H - 3} textAnchor="middle" className="bc-t">{n.dow[0]}</text>
          </g>
        );
      })}
    </svg>
    <p className="bc-cap">Middle of each night&apos;s sleep against your usual (dashed line). Higher is earlier; a ring is off the scale.</p>
    </>
  );
}

function Row({ label, value, m }: { label: string; value: React.ReactNode; m: Metric<unknown> }) {
  return (
    <div className="bc-row">
      <span>{label}</span>
      {m.value === null ? <em>{need(m)}</em> : <b>{value}</b>}
    </div>
  );
}

export function Rows({ bc }: { bc: BodyClock }) {
  const wk = bc.weekendShift, nw = bc.naturalWindow, bt = bc.backOnTrack;
  return (
    <div className="bc-rows">
      <Row label="Usual middle of sleep" m={bc.usualMid} value={bc.usualMid.value !== null && clockLabel(bc.usualMid.value)} />
      <Row label="Weekend nights" m={wk}
        value={wk.value !== null && (Math.abs(wk.value) < 5 ? "no shift" : `${Math.abs(Math.round(wk.value))} min ${wk.value > 0 ? "later" : "earlier"}`)} />
      <Row label="Natural window" m={nw} value={nw.value !== null && `${clockLabel(nw.value.start)}–${clockLabel(nw.value.end)}`} />
      <Row label="Back on track" m={bt}
        value={bt.value !== null && `usual wake ${clockLabel(bt.value.usualWake)} · ${bt.value.within} of ${bt.value.of} mornings`} />
    </div>
  );
}

// What a test says, from its Findings (one per outcome, or per band and outcome).
// Any outcome that passed gives its headline. All of them past the gate with nothing
// found reads "No clear effect yet". Otherwise "Not clear yet" with the recovery
// Finding's own progress line (the outcomes share one gate; recovery is the one the
// app leads with), so the count is the test's own and never an estimate.
function Verdict({ findings }: { findings: Finding[] }) {
  if (!findings.length) return <p className="bc-p"><b>Not clear yet.</b></p>;
  const passed = findings.filter((f) => f.status === "pass" && f.headline);
  if (passed.length) return <>{passed.map((f) => <p key={f.id} className="bc-p"><b>{f.headline}</b></p>)}</>;
  if (findings.every((f) => f.status === "unclear")) return <p className="bc-p"><b>No clear effect yet.</b> Checked on {Math.max(...findings.map((f) => f.n))} nights where drinking is known, with drinking taken out; nothing stands out.</p>;
  const short = findings.filter((f) => f.status === "insufficient");
  const lead = short.find((f) => f.unit === "recovery points") ?? short[0];
  return <p className="bc-p"><b>Not clear yet.</b> {progressSentence(lead.progress)}</p>;
}

// Filled from the H2b (irregularity) Findings, one per outcome.
export function HarmBlock({ findings = [] }: { findings?: Finding[] }) {
  return (
    <div className="bc-blk">
      <div className="bc-bh">Is it harming you?</div>
      <Verdict findings={findings.filter((f) => f.id.startsWith("H2b-"))} />
      <p className="bc-res">In a study of 61,000 UK adults over up to 8 years, the most irregular sleepers had the highest risk of death; more regular groups were 20–48% lower. A finding about large groups, not proof about you.</p>
    </div>
  );
}

// Filled from the H2a (three-band timing) Findings: nights asleep an hour or more
// earlier or later than usual, each against your near-usual nights.
export function TimingBlock({ findings = [] }: { findings?: Finding[] }) {
  return (
    <div className="bc-blk">
      <div className="bc-bh">Best timing for you</div>
      <Verdict findings={findings.filter((f) => f.id.startsWith("H2a-"))} />
      <p className="bc-res">Nights you fell asleep an hour or more earlier, or later, than your usual, compared with nights near it, on recovery, HRV and resting heart rate. Sleep length, the day before&apos;s strain and drinking are held fixed; nights with no drinking record are left out.</p>
    </div>
  );
}

export const FOOTNOTE = "Regularity is worked out from WHOOP's sleep start and end times. 100 is identical every day, 0 is no better than chance, below 0 is closer to opposite.";
