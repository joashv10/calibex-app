// Progress + Insights trends: raw rows in, chart-ready series out.
// Fetching is one function (fetchTrendRows); everything else is pure, so it can
// be checked against a fixture. Descriptive only: no claim is made here, and
// "vs normal" is always against YOUR days before the range (principle #4).
import { supabase } from "./supabaseClient";
import { addDays, normalBefore, NOT_SESSIONS, type Cycle } from "./readout";
import { e1rmRefFrom, strengthLoad, trimp } from "./load";
import { cleanWorkouts, type LiftEntry, type WhoopWorkout } from "./train";
import { dayKcal, type EnergyBurn, type EnergySkip } from "./energy";

export type Range = 7 | 28 | 84;
export const RANGES: { days: Range; label: string }[] = [
  { days: 7, label: "7d" }, { days: 28, label: "4w" }, { days: 84, label: "12w" },
];

// brand "supplement" marks a protein-powder row (lib/food.ts logProteinScoops): its macros count, but alone it doesn't make a logged day.
export type FoodRow = { wake_date: string; slot: string | null; kcal: number | null; protein_g: number | null; eaten_at: string | null; brand?: string | null };
const isMealRow = (r: FoodRow) => r.brand !== "supplement";
export type WeightRow = { wake_date: string; value: number; measured_at: string };
export type LiftRow = {
  wake_date: string; entry_id: string; exercise_id: string; exercise_name: string;
  tracking_type: LiftEntry["tracking_type"]; set_index: number;
  weight: number | string | null; reps: number | null; duration_sec: number | null;
};
// alcohol_g / carb_g: alcohol rows only, null on old bucket-only rows
export type SubstanceRow = { wake_date: string; substance: string; alcohol_g?: number | null; carb_g?: number | null };
export type TrendRows = {
  workouts: WhoopWorkout[]; lifts: LiftRow[]; food: FoodRow[]; weights: WeightRow[]; substances: SubstanceRow[];
  skips: EnergySkip[]; burn: EnergyBurn[]; // for the Energy section (last 7 days)
};

const WCOLS = "id,wake_date,sport_name,duration_minutes,distance_meters,average_heart_rate,max_heart_rate,strain_score,calories_burned,workout_start,workout_end,zone_one_percent,zone_two_percent,zone_three_percent,zone_four_percent,zone_five_percent";

// Everything the longest range (12w) needs. Cycles come from getCycles() (all history).
export async function fetchTrendRows(today: string): Promise<TrendRows> {
  const from = addDays(today, -83);
  const [wo, li, fo, we, su, sk, bu] = await Promise.all([
    supabase.from("workouts").select(WCOLS).gte("wake_date", from).lte("wake_date", today),
    supabase.from("lift_log").select("wake_date,entry_id,exercise_id,exercise_name,tracking_type,set_index,weight,reps,duration_sec").gte("wake_date", from).lte("wake_date", today),
    supabase.from("food_log").select("wake_date,slot,kcal,protein_g,eaten_at,brand").gte("wake_date", from).lte("wake_date", today),
    supabase.from("body_measurements").select("wake_date,value,measured_at").eq("metric", "weight").order("measured_at"),
    supabase.from("substance_log").select("wake_date,substance,alcohol_g,carb_g"),
    supabase.from("meal_skips").select("wake_date,slot").gte("wake_date", from).lte("wake_date", today),
    supabase.from("cycles").select("wake_date,day_calories,cycle_end").gte("wake_date", from).lte("wake_date", today),
  ]);
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    workouts: (wo.data ?? []) as WhoopWorkout[],
    lifts: (li.data ?? []) as LiftRow[],
    food: ((fo.data ?? []) as Record<string, unknown>[]).map((r) => ({
      wake_date: r.wake_date as string, slot: (r.slot as string) ?? null, eaten_at: (r.eaten_at as string) ?? null,
      kcal: num(r.kcal), protein_g: num(r.protein_g), brand: (r.brand as string) ?? null,
    })),
    weights: ((we.data ?? []) as { wake_date: string; value: unknown; measured_at: string }[])
      .map((r) => ({ wake_date: r.wake_date, value: Number(r.value), measured_at: r.measured_at })),
    substances: (su.data ?? []) as SubstanceRow[],
    skips: (sk.data ?? []) as EnergySkip[],
    burn: ((bu.data ?? []) as { wake_date: string; day_calories: unknown; cycle_end: string | null }[]).map((r) => ({ wake_date: r.wake_date, day_calories: num(r.day_calories), cycle_end: r.cycle_end })),
  };
}

// Oldest → newest, `days` long, ending today.
export function rangeDays(today: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(today, i - (days - 1)));
}

// Rolling 7-day buckets ending today (always full weeks, never a stub "this week").
export function weekBuckets(days: string[]): string[][] {
  const out: string[][] = [];
  for (let end = days.length; end > 0; end -= 7) out.unshift(days.slice(Math.max(0, end - 7), end));
  return out;
}

export type Point = { key: string; label: string; value: number | null; n?: number; of?: number };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const weekday = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });

// ── Recovery ────────────────────────────────────────────────────────────────
export type Vital = { key: "recovery_score" | "hrv_rmssd_ms" | "resting_heart_rate" | "step_count"; label: string; unit: string; avg: number | null; normal: number | null; n: number; series: Point[] };
const VITALS: Omit<Vital, "avg" | "normal" | "n" | "series">[] = [
  { key: "recovery_score", label: "Recovery", unit: "%" },
  { key: "hrv_rmssd_ms", label: "HRV", unit: "ms" },
  { key: "resting_heart_rate", label: "Resting HR", unit: "bpm" },
  { key: "step_count", label: "Steps", unit: "steps" },
];

// Daily values over the range; a day WHOOP didn't score is null (a gap, never 0).
// Normal = median of the 28 scored days before the range starts. `today`'s steps are
// still accumulating, so that day is a gap in the steps series (never a low day).
export function vitals(cycles: Cycle[], days: string[], today?: string): Vital[] {
  const by = new Map(cycles.map((c) => [c.wake_date, c]));
  return VITALS.map((v) => {
    const series = days.map((d) => ({ key: d, label: days.length <= 7 ? weekday(d) : shortDate(d), value: v.key === "step_count" && d === today ? null : (by.get(d)?.[v.key] as number | null | undefined) ?? null }));
    const vals = series.map((p) => p.value).filter((x): x is number => x != null);
    return { ...v, avg: mean(vals), normal: normalBefore(cycles, days[0], v.key), n: vals.length, series };
  });
}

// ── Training ────────────────────────────────────────────────────────────────
export type LoadBar = { key: string; label: string; strength: number; cardio: number };
export type Training = { bars: LoadBar[]; sessions: number; minutes: number; strengthDays: number; daily: boolean };

function liftEntries(rows: LiftRow[]): (LiftEntry & { wake_date: string })[] {
  const by = new Map<string, LiftRow[]>();
  for (const r of rows) { if (!by.has(r.entry_id)) by.set(r.entry_id, []); by.get(r.entry_id)!.push(r); }
  return [...by.values()].map((g) => {
    g.sort((a, b) => a.set_index - b.set_index);
    const f = g[0];
    return {
      entry_id: f.entry_id, exercise_id: f.exercise_id, exercise_name: f.exercise_name, tracking_type: f.tracking_type, wake_date: f.wake_date,
      sets: g.map((r) => ({ weight: r.weight == null ? null : Number(r.weight), reps: r.reps == null ? null : Number(r.reps), duration_sec: r.duration_sec == null ? null : Number(r.duration_sec) })),
    };
  });
}

const isSession = (sport: string) => !NOT_SESSIONS.has(sport.toLowerCase().replace(/-/g, " "));

// Strength = lift-log load (lib/load.ts); cardio = WHOOP TRIMP. Daily bars for 7d,
// weekly sums otherwise. Sessions are WHOOP-tracked sessions (walks etc. excluded).
export function training(rows: TrendRows, days: string[], bodyweightKg: number | null): Training {
  const inRange = new Set(days);
  const workouts = cleanWorkouts(rows.workouts).filter((w) => inRange.has(w.wake_date));
  const entries = liftEntries(rows.lifts.filter((r) => inRange.has(r.wake_date)));
  const ref = e1rmRefFrom(entries);
  const strength = new Map<string, number>(), cardio = new Map<string, number>();
  const byDay = new Map<string, LiftEntry[]>();
  for (const e of entries) { if (!byDay.has(e.wake_date)) byDay.set(e.wake_date, []); byDay.get(e.wake_date)!.push(e); }
  for (const [d, es] of byDay) strength.set(d, strengthLoad(es, ref, bodyweightKg));
  for (const w of workouts) { const t = trimp(w); if (t != null) cardio.set(w.wake_date, (cardio.get(w.wake_date) ?? 0) + t); }
  const sessions = workouts.filter((w) => isSession(w.sport_name));
  const daily = days.length <= 7;
  const groups = daily ? days.map((d) => [d]) : weekBuckets(days);
  const bars = groups.map((g) => ({
    key: g[0], label: daily ? weekday(g[0]) : shortDate(g[0]),
    strength: g.reduce((s, d) => s + (strength.get(d) ?? 0), 0),
    cardio: g.reduce((s, d) => s + (cardio.get(d) ?? 0), 0),
  }));
  return {
    bars, daily, sessions: sessions.length, strengthDays: byDay.size,
    minutes: Math.round(sessions.reduce((s, w) => s + Number(w.duration_minutes ?? 0), 0)),
  };
}

// ── Food ────────────────────────────────────────────────────────────────────
// A "logged day" is a day with at least one food entry. Averages are over logged
// days only: an unlogged day is missing data, not a zero-calorie day.
export type Food = { points: Point[]; loggedDays: number; kcal: number | null; protein: number | null; daily: boolean };
// Drinks count in a day's calories, as on the Food page; a drinks-only day still isn't a logged day.
export function food(rows: FoodRow[], days: string[], subs: SubstanceRow[] = []): Food {
  const kcalOf = dayKcal(rows, subs); // shared with the Energy section, so both use one formula
  const sums = new Map<string, { kcal: number; protein: number }>();
  for (const r of rows) {
    const t = sums.get(r.wake_date) ?? { kcal: kcalOf.get(r.wake_date) ?? 0, protein: 0 };
    t.protein += r.protein_g ?? 0;
    sums.set(r.wake_date, t);
  }
  const meal = new Set(rows.filter(isMealRow).map((r) => r.wake_date));
  const tot = new Map([...sums].filter(([d]) => meal.has(d)));
  const logged = days.filter((d) => tot.has(d));
  const daily = days.length <= 28;
  const groups = daily ? days.map((d) => [d]) : weekBuckets(days);
  const points = groups.map((g) => {
    const ks = g.filter((d) => tot.has(d)).map((d) => tot.get(d)!.kcal);
    return { key: g[0], label: days.length <= 7 ? weekday(g[0]) : shortDate(g[0]), value: mean(ks), n: ks.length, of: g.length };
  });
  return {
    points, daily, loggedDays: logged.length,
    kcal: mean(logged.map((d) => tot.get(d)!.kcal)), protein: mean(logged.map((d) => tot.get(d)!.protein)),
  };
}

// ── Body ────────────────────────────────────────────────────────────────────
// Weigh-ins inside the range, plus the latest one ever (shown even if older).
export function body(weights: WeightRow[], days: string[]) {
  const inRange = new Set(days);
  return { points: weights.filter((w) => inRange.has(w.wake_date)), latest: weights[weights.length - 1] ?? null };
}

// ── Insights patterns (descriptive) ────────────────────────────────────────
// Monthly average recovery over all WHOOP history. n = scored days that month.
export function recoveryByMonth(cycles: Cycle[]): Point[] {
  const by = new Map<string, number[]>();
  for (const c of cycles) {
    if (c.recovery_score == null) continue;
    const k = c.wake_date.slice(0, 7);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(c.recovery_score);
  }
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => {
    const [y, m] = k.split("-").map(Number);
    const daysIn = new Date(y, m, 0).getDate();
    return { key: k, label: new Date(y, m - 1, 15).toLocaleDateString("en-US", { month: "short" }), value: mean(v), n: v.length, of: daysIn };
  });
}

// HRV over the last `days` days, with a trailing 30-day mean (needs 10 scored days).
export function hrvTrend(cycles: Cycle[], today: string, days = 90): { daily: Point[]; rolling: Point[] } {
  const span = rangeDays(today, days);
  const by = new Map(cycles.map((c) => [c.wake_date, c.hrv_rmssd_ms]));
  const daily = span.map((d) => ({ key: d, label: shortDate(d), value: by.get(d) ?? null }));
  const rolling = span.map((d) => {
    const win = rangeDays(d, 30).map((x) => by.get(x)).filter((x): x is number => x != null);
    return { key: d, label: shortDate(d), value: win.length >= 10 ? mean(win) : null };
  });
  return { daily, rolling };
}

// Minutes after `fromHour` in `tz` (18:00 default: 23:30 → 330, 01:15 → 435), so
// times either side of midnight sort and average sanely. Dinners use noon.
export function eveningMinutes(iso: string, tz: string, fromHour = 18): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const h = Number(p.find((x) => x.type === "hour")?.value), m = Number(p.find((x) => x.type === "minute")?.value);
  return ((h * 60 + m) - fromHour * 60 + 1440) % 1440;
}
export const clockFromEvening = (min: number) => {
  const t = Math.round(min + 18 * 60) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

// Bedtimes for the last `days` nights: the median and the middle-half spread (IQR).
export function bedtimes(cycles: Cycle[], today: string, tz: string, days = 30) {
  const span = new Set(rangeDays(today, days));
  const pts = cycles.filter((c) => span.has(c.wake_date) && c.sleep_start)
    .map((c) => ({ key: c.wake_date, label: shortDate(c.wake_date), value: eveningMinutes(c.sleep_start!, tz) }));
  const s = pts.map((p) => p.value).sort((a, b) => a - b);
  const q = (f: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(f * (s.length - 1) + 0.5))] : null);
  return { points: pts, median: q(0.5), q1: q(0.25), q3: q(0.75), n: s.length };
}

// ── Testing next: the inputs pendingTests() (lib/stats.ts) counts ──────────
// All history: arms fill over months, not one range.
export async function fetchTestingRows(): Promise<{ food: FoodRow[]; substances: SubstanceRow[] }> {
  const [fo, su] = await Promise.all([
    supabase.from("food_log").select("wake_date,slot,kcal,protein_g,eaten_at,brand"),
    supabase.from("substance_log").select("wake_date,substance"),
  ]);
  return { food: (fo.data ?? []) as FoodRow[], substances: (su.data ?? []) as SubstanceRow[] };
}

export function testingInputs(foodRows: FoodRow[], subs: SubstanceRow[], tz: string, settingsDinner: string | null) {
  const first = new Map<string, string>();
  for (const f of foodRows) {
    if (f.slot !== "dinner" || !f.eaten_at) continue;
    const prev = first.get(f.wake_date);
    if (!prev || f.eaten_at < prev) first.set(f.wake_date, f.eaten_at);
  }
  const [h, m] = (settingsDinner ?? "").split(":").map(Number);
  return {
    dinners: [...first].map(([day, iso]) => ({ day, min: eveningMinutes(iso, tz, 12) })),
    settingsDinnerMin: Number.isFinite(h) && Number.isFinite(m) ? ((h * 60 + m) - 12 * 60 + 1440) % 1440 : null,
    drinkDays: new Set(subs.filter((s) => s.substance === "alcohol").map((s) => s.wake_date)),
    foodDays: new Set(foodRows.filter(isMealRow).map((f) => f.wake_date)),
  };
}
