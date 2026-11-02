"use client";
// CALIBEX training load — two legible channels, never one opaque merged score.
//
//   strength = Σ reps × effectiveWeight × (weight/e1RM) × exp(−k·estRIR)
//              (intensity- and proximity-to-failure-weighted volume load;
//               tonnage alone is a validated-weak proxy — %1RM and closeness
//               to failure are what drive fatigue)
//   cardio   = Edwards TRIMP = Σ zone-minutes × zone-weight(1..5) from WHOOP
//              (HR-based load provably under-credits lifting → never used for it)
//
// Both read as deviation from YOUR rolling 28-day baseline (principle #4).
// A unified z-score view switches on only once strength has a full window —
// below that the card says "building baseline", never a confabulated number.
import { supabase } from "./supabaseClient";
import { logDate } from "./day";
import { exerciseById } from "./exercises";
import { cleanWorkouts, type LiftEntry, type WhoopWorkout } from "./train";
import { e1rmRefFrom, strengthLoad } from "./loadMath";
export { e1rmRefFrom, strengthLoad };

// ── cardio channel: Edwards TRIMP ───────────────────────────────────────────
// zone percentages are 0–100 and deliberately don't sum to 100 (zone 0 <50%HRmax
// carries weight 0). zone-minutes × weight 1..5.
export function trimp(w: WhoopWorkout): number | null {
  if (!w.duration_minutes) return null;
  const zones = [w.zone_one_percent, w.zone_two_percent, w.zone_three_percent, w.zone_four_percent, w.zone_five_percent];
  if (zones.every((z) => z == null)) return null;
  const t = zones.reduce<number>((s, z, i) => s + ((z ?? 0) / 100) * w.duration_minutes! * (i + 1), 0);
  return Math.round(t);
}

// ── session pairing: WHOOP HR window × CALIBEX set logs ────────────────────
// One gym session, both dimensions: cardiovascular strain measured by WHOOP
// during the workout window, muscular load computed from the sets you logged.
// Match rule: a lift entry belongs to the workout whose window (start −15min …
// end +45min, save-after-gym grace) contains its logged_at; nearest-midpoint
// wins if windows overlap.
export type PairedSession = {
  workout_id: string; sport: string; start: string;
  durationMin: number | null; avgHR: number | null; strain: number | null;
  trimp: number | null; muscularAU: number; exercises: number;
};

const MATCH_BEFORE_MS = 15 * 60000;
const MATCH_AFTER_MS = 45 * 60000;

export function pairSessions(
  entries: (LiftEntry & { wake_date?: string })[],
  workouts: WhoopWorkout[],
  e1rmRef: Map<string, number>,
  bodyweightKg: number | null
): { sessions: PairedSession[]; unmatched: LiftEntry[] } {
  const byWorkout = new Map<string, LiftEntry[]>();
  const unmatched: LiftEntry[] = [];
  for (const e of entries) {
    const t = e.logged_at ? new Date(e.logged_at).getTime() : NaN;
    let best: WhoopWorkout | null = null;
    let bestDist = Infinity;
    if (Number.isFinite(t)) {
      for (const w of workouts) {
        if (!w.workout_end) continue;
        const s = new Date(w.workout_start).getTime();
        const en = new Date(w.workout_end).getTime();
        if (t < s - MATCH_BEFORE_MS || t > en + MATCH_AFTER_MS) continue;
        const dist = Math.abs(t - (s + en) / 2);
        if (dist < bestDist) { best = w; bestDist = dist; }
      }
    }
    if (best) {
      if (!byWorkout.has(best.id)) byWorkout.set(best.id, []);
      byWorkout.get(best.id)!.push(e);
    } else unmatched.push(e);
  }
  const sessions: PairedSession[] = [];
  for (const [wid, es] of byWorkout) {
    const w = workouts.find((x) => x.id === wid)!;
    sessions.push({
      workout_id: wid, sport: w.sport_name, start: w.workout_start,
      durationMin: w.duration_minutes, avgHR: w.average_heart_rate, strain: w.strain_score,
      trimp: trimp(w), muscularAU: strengthLoad(es, e1rmRef, bodyweightKg), exercises: es.length,
    });
  }
  return { sessions: sessions.sort((a, b) => a.start.localeCompare(b.start)), unmatched };
}

// ── daily series + baselines ───────────────────────────────────────────────
export type LoadDay = { date: string; strength: number; cardio: number };
export type LoadSummary = {
  today: { strength: number; cardio: number };
  // per-channel 28d baseline (mean over the trailing window, rest days = 0)
  baseline: { strength: number | null; cardio: number | null };
  deltaPct: { strength: number | null; cardio: number | null };
  // unified deviation in SD units — only once strength has a full 28d window
  unifiedSd: number | null;
  strengthDaysSpan: number; // days since first logged lift (for "building baseline · day N/28")
  bodyweightMissing: boolean; // bodyweight/hold sets excluded because no weigh-in exists
  bodyweightAgeDays: number | null; // days since the last weigh-in (weekly-update nudge)
  // today's gym sessions, each pairing WHOOP's HR window with your logged sets
  sessions: PairedSession[];
  unmatchedAU: number; // muscular AU from lifts not (yet) inside any WHOOP window
};

const WINDOW = 28;

function dateRange(days: number): string[] {
  const out: string[] = [];
  const today = logDate(); // the day in view (calendar), not always now
  const d = new Date(today + "T12:00:00");
  for (let i = days; i >= 1; i--) {
    const x = new Date(d); x.setDate(d.getDate() - i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

type LiftRow = {
  wake_date: string; entry_id: string; exercise_id: string; exercise_name: string;
  tracking_type: LiftEntry["tracking_type"]; set_index: number;
  weight: number | string | null; reps: number | null; duration_sec: number | null; logged_at: string;
};

function rowsToEntries(rows: LiftRow[]): (LiftEntry & { wake_date: string })[] {
  const by = new Map<string, LiftRow[]>();
  for (const r of rows) { if (!by.has(r.entry_id)) by.set(r.entry_id, []); by.get(r.entry_id)!.push(r); }
  return [...by.values()].map((g) => {
    g.sort((a, b) => a.set_index - b.set_index);
    const f = g[0];
    return {
      entry_id: f.entry_id, exercise_id: f.exercise_id, exercise_name: f.exercise_name,
      tracking_type: f.tracking_type, logged_at: f.logged_at, wake_date: f.wake_date,
      sets: g.map((r) => ({
        weight: r.weight == null ? null : Number(r.weight),
        reps: r.reps == null ? null : Number(r.reps),
        duration_sec: r.duration_sec == null ? null : Number(r.duration_sec),
      })),
    };
  });
}

export async function getLoadSummary(): Promise<LoadSummary> {
  const today = logDate(); // the day in view (calendar), not always now
  const windowDates = dateRange(WINDOW);
  const from = windowDates[0];

  const [liftsQ, workoutsQ, bwQ, firstLiftQ] = await Promise.all([
    supabase.from("lift_log").select("wake_date,entry_id,exercise_id,exercise_name,tracking_type,set_index,weight,reps,duration_sec,logged_at").gte("wake_date", from),
    supabase.from("workouts")
      .select("id,wake_date,sport_name,duration_minutes,distance_meters,average_heart_rate,max_heart_rate,strain_score,calories_burned,workout_start,workout_end,zone_one_percent,zone_two_percent,zone_three_percent,zone_four_percent,zone_five_percent")
      .gte("wake_date", from),
    supabase.from("body_measurements").select("value,measured_at").eq("metric", "weight").order("measured_at", { ascending: false }).limit(1),
    supabase.from("lift_log").select("wake_date").order("wake_date").limit(1),
  ]);

  const bwRow = bwQ.data?.[0] as { value: unknown; measured_at: string } | undefined;
  const bodyweight = bwRow ? Number(bwRow.value) : null;
  const bodyweightAgeDays = bwRow ? Math.floor((Date.now() - new Date(bwRow.measured_at).getTime()) / 86400000) : null;
  const entries = rowsToEntries((liftsQ.data as LiftRow[]) ?? []);
  const e1rmRef = e1rmRefFrom(entries);
  const workouts = cleanWorkouts(((workoutsQ.data as WhoopWorkout[]) ?? []));

  // daily strength
  const strengthByDay = new Map<string, number>();
  for (const d of [...windowDates, today]) strengthByDay.set(d, 0);
  const byDay = new Map<string, LiftEntry[]>();
  for (const e of entries) { if (!byDay.has(e.wake_date)) byDay.set(e.wake_date, []); byDay.get(e.wake_date)!.push(e); }
  let bodyweightMissing = false;
  for (const [d, es] of byDay) {
    strengthByDay.set(d, strengthLoad(es, e1rmRef, bodyweight));
    if (bodyweight == null && es.some((e) => e.tracking_type !== "weight_reps")) bodyweightMissing = true;
  }

  // daily cardio
  const cardioByDay = new Map<string, number>();
  for (const d of [...windowDates, today]) cardioByDay.set(d, 0);
  for (const w of workouts) {
    const t = trimp(w);
    if (t != null && cardioByDay.has(w.wake_date)) cardioByDay.set(w.wake_date, (cardioByDay.get(w.wake_date) ?? 0) + t);
  }

  const meanSd = (vals: number[]): { mean: number; sd: number } => {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    return { mean, sd };
  };

  const strengthWindow = windowDates.map((d) => strengthByDay.get(d) ?? 0);
  const cardioWindow = windowDates.map((d) => cardioByDay.get(d) ?? 0);
  const sStat = meanSd(strengthWindow);
  const cStat = meanSd(cardioWindow);

  const firstLift = (firstLiftQ.data?.[0] as { wake_date: string } | undefined)?.wake_date ?? null;
  const strengthDaysSpan = firstLift
    ? Math.floor((new Date(today + "T12:00:00").getTime() - new Date(firstLift + "T12:00:00").getTime()) / 86400000) + 1
    : 0;

  const todayS = strengthByDay.get(today) ?? 0;
  const todayC = cardioByDay.get(today) ?? 0;

  const cardioBaseline = cStat.mean > 0 ? Math.round(cStat.mean) : null;
  const strengthBaseline = strengthDaysSpan >= WINDOW && sStat.mean > 0 ? Math.round(sStat.mean) : null;

  // unified deviation (SD units) — gated on a full strength window
  let unifiedSd: number | null = null;
  if (strengthBaseline != null && cardioBaseline != null && sStat.sd > 0 && cStat.sd > 0) {
    unifiedSd = ((todayS - sStat.mean) / sStat.sd + (todayC - cStat.mean) / cStat.sd) / 2;
  }

  // today's session pairing: WHOOP HR windows × logged sets
  const todayEntries = byDay.get(today) ?? [];
  const todayWorkouts = workouts.filter((w) => w.wake_date === today);
  const { sessions, unmatched } = pairSessions(todayEntries, todayWorkouts, e1rmRef, bodyweight);
  const unmatchedAU = strengthLoad(unmatched, e1rmRef, bodyweight);

  return {
    today: { strength: todayS, cardio: todayC },
    baseline: { strength: strengthBaseline, cardio: cardioBaseline },
    deltaPct: {
      strength: strengthBaseline ? Math.round(((todayS - strengthBaseline) / strengthBaseline) * 100) : null,
      cardio: cardioBaseline ? Math.round(((todayC - cardioBaseline) / cardioBaseline) * 100) : null,
    },
    unifiedSd,
    strengthDaysSpan,
    bodyweightMissing,
    bodyweightAgeDays,
    sessions,
    unmatchedAU,
  };
}

// Per-workout load for list rows (cardio channel).
export function workoutLoad(w: WhoopWorkout): number | null { return trimp(w); }

// Muscle groups of a set of entries (for future session_log / analysis use).
export function musclesOf(entries: LiftEntry[]): string[] {
  const s = new Set<string>();
  for (const e of entries) exerciseById(e.exercise_id)?.pm.forEach((m) => s.add(m));
  return [...s];
}
