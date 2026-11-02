// Weekly energy balance: eaten vs burned over the last 7 COMPLETE days. Pure (no
// supabase import) so node tests can load it. One day is noisy (WHOOP's day_calories
// depends on how long that sleep-to-sleep cycle ran), so only a 7-day average is shown,
// and only when enough days are fully logged (principle #6: say "not enough" otherwise).
import { drinkKcal } from "./alcohol.ts";

export type EnergyFood = { wake_date: string; slot: string | null; kcal: number | null; brand?: string | null };
export type EnergySub = { wake_date: string; substance: string; alcohol_g?: number | null; carb_g?: number | null };
export type EnergySkip = { wake_date: string; slot: string };
// cycle_end null = the WHOOP cycle is still running, so its calories are a partial total
export type EnergyBurn = { wake_date: string; day_calories: number | null; cycle_end: string | null };
export type EnergyWeight = { wake_date: string; value: number; measured_at: string };

export const WINDOW = 7;
export const MIN_DAYS = 5;
export const SCALE_MIN_SPAN = 14;
export const SCALE_MIN_COVER = 0.7;
export const KCAL_PER_KG = 7700;
export const WEIGH_SD_KG = 0.5; // one weigh-in moves about this much day to day
const REQUIRED_SLOTS = ["breakfast", "lunch", "dinner"]; // afternoon is optional

// Per-day eaten kcal: food (protein scoops included) plus alcohol, as the Food page totals it.
export function dayKcal(food: EnergyFood[], subs: EnergySub[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of food) m.set(r.wake_date, (m.get(r.wake_date) ?? 0) + (r.kcal ?? 0));
  for (const s of subs) {
    if (s.substance === "alcohol" && s.alcohol_g != null) {
      m.set(s.wake_date, (m.get(s.wake_date) ?? 0) + drinkKcal(Number(s.alcohol_g), s.carb_g == null ? null : Number(s.carb_g)));
    }
  }
  return m;
}

function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export type Scale =
  | { open: false }
  | { open: true; from: string; to: string; spanDays: number; kgChange: number; scalePerDay: number; scaleRange: number; logPerDay: number; consistent: boolean };

export type Energy = {
  days: string[]; logged: number;
  eatenAvg: number | null; burnAvg: number | null; diffAvg: number | null;
  gated: boolean; scale: Scale;
};

export function energyBalance(
  rows: { food: EnergyFood[]; skips: EnergySkip[]; burn: EnergyBurn[]; weights: EnergyWeight[]; substances?: EnergySub[] },
  today: string,
): Energy {
  const eaten = dayKcal(rows.food, rows.substances ?? []);
  const slotsEaten = new Map<string, Set<string>>();
  for (const r of rows.food) {
    if (r.brand === "supplement" || !r.slot) continue; // a protein scoop is not a meal
    if (!slotsEaten.has(r.wake_date)) slotsEaten.set(r.wake_date, new Set());
    slotsEaten.get(r.wake_date)!.add(r.slot);
  }
  const skipped = new Map<string, Set<string>>();
  for (const s of rows.skips) {
    if (!skipped.has(s.wake_date)) skipped.set(s.wake_date, new Set());
    skipped.get(s.wake_date)!.add(s.slot);
  }
  const burn = new Map<string, number>();
  for (const b of rows.burn) if (b.day_calories != null && b.cycle_end != null) burn.set(b.wake_date, Number(b.day_calories));

  // The day counts when it is fully logged AND WHOOP has a burn for it.
  const counts = (d: string) =>
    burn.has(d) && REQUIRED_SLOTS.every((s) => slotsEaten.get(d)?.has(s) || skipped.get(d)?.has(s));
  const avgDiff = (ds: string[]) => ds.reduce((a, d) => a + (eaten.get(d) ?? 0) - burn.get(d)!, 0) / ds.length;

  const days = Array.from({ length: WINDOW }, (_, i) => addDays(today, i - WINDOW)); // today excluded
  const ok = days.filter(counts);
  const gated = ok.length < MIN_DAYS;

  let scale: Scale = { open: false };
  const ws = [...rows.weights].sort((a, b) => a.measured_at.localeCompare(b.measured_at));
  const latest = ws[ws.length - 1];
  if (latest) {
    // closest weigh-in that is at least 14 days before the latest
    const older = ws.filter((w) => daysBetween(w.wake_date, latest.wake_date) >= SCALE_MIN_SPAN);
    const first = older[older.length - 1];
    if (first) {
      const span = daysBetween(first.wake_date, latest.wake_date);
      const between = Array.from({ length: span }, (_, i) => addDays(first.wake_date, i)).filter((d) => d < today);
      const good = between.filter(counts);
      if (good.length / span >= SCALE_MIN_COVER) {
        const kg = latest.value - first.value;
        // Two weigh-ins, each off by ~0.5 kg: the change is off by sqrt(2) x that.
        const scalePerDay = Math.round((kg * KCAL_PER_KG) / span);
        const scaleRange = Math.round((Math.SQRT2 * WEIGH_SD_KG * KCAL_PER_KG) / span);
        const logPerDay = Math.round(avgDiff(good));
        scale = {
          open: true, from: first.wake_date, to: latest.wake_date, spanDays: span, kgChange: kg,
          scalePerDay, scaleRange, logPerDay, consistent: Math.abs(logPerDay - scalePerDay) <= scaleRange,
        };
      }
    }
  }

  if (gated) return { days, logged: ok.length, eatenAvg: null, burnAvg: null, diffAvg: null, gated, scale };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    days, logged: ok.length, gated,
    eatenAvg: Math.round(mean(ok.map((d) => eaten.get(d) ?? 0))),
    burnAvg: Math.round(mean(ok.map((d) => burn.get(d)!))),
    diffAvg: Math.round(avgDiff(ok)),
    scale,
  };
}
