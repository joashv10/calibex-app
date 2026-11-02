'use client';
// What comes back to you: every WHOOP number next to your own normal, and each day's
// behaviour next to the recovery it produced the next morning (READOUT_SPEC.md).
// Raw numbers side by side; no claim is made here. Claims live in lib/stats.ts, gated.
import { supabase } from './supabaseClient';
import { cleanWorkouts } from './train';
import { nightLabel } from './alcohol';
import type { CycleRow, DrinkRows } from './stats';

export type Cycle = CycleRow & { sleep_performance_percent: number | null };

const CYCLE_COLS = 'wake_date,recovery_score,hrv_rmssd_ms,resting_heart_rate,day_strain,sleep_start,sleep_end,total_sleep_minutes,deep_sleep_minutes,sleep_performance_percent,step_count';

// All of WHOOP history (~1 row a day): small, and the analyses need all of it.
// fetchCycles throws when the read fails (the Body clock says so instead of "still learning");
// getCycles keeps the old quiet-empty behaviour for the other screens.
export async function fetchCycles(): Promise<Cycle[]> {
  const { data, error } = await supabase.from('cycles').select(CYCLE_COLS).order('wake_date');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const n = (k: string) => (r[k] == null ? null : Number(r[k]));
    return {
      wake_date: r.wake_date as string,
      recovery_score: n('recovery_score'), hrv_rmssd_ms: n('hrv_rmssd_ms'), resting_heart_rate: n('resting_heart_rate'),
      day_strain: n('day_strain'), sleep_start: (r.sleep_start as string) ?? null, sleep_end: (r.sleep_end as string) ?? null,
      total_sleep_minutes: n('total_sleep_minutes'), deep_sleep_minutes: n('deep_sleep_minutes'),
      sleep_performance_percent: n('sleep_performance_percent'), step_count: n('step_count'),
    };
  });
}

export async function getCycles(): Promise<Cycle[]> {
  try { return await fetchCycles(); } catch (e) { console.error(e); return []; }
}

// Days the H0 tests leave out: travel and sick (rest days stay in). Read-only.
export async function getExcludedDays(): Promise<string[]> {
  const { data, error } = await supabase.from('day_context').select('wake_date').in('context', ['travel', 'sick']);
  if (error) { console.error(error); return []; }
  return ((data ?? []) as { wake_date: string }[]).map((r) => r.wake_date);
}

// Drinking per night for the sleep tests (stats.drinkStatus): the WHOOP journal, the
// dinner check-in AL1 and alcohol logged in Food. All history, read-only.
export async function getDrinkRows(): Promise<DrinkRows> {
  const [jo, ir, su] = await Promise.all([
    supabase.from('journal').select('wake_date,answered_yes').eq('question', 'Have any alcoholic drinks?'),
    supabase.from('item_responses').select('wake_date,raw_value,status').eq('item_id', 'AL1'),
    supabase.from('substance_log').select('wake_date,substance').eq('substance', 'alcohol'),
  ]);
  for (const r of [jo, ir, su]) if (r.error) console.error(r.error);
  return {
    journal: (jo.data ?? []) as DrinkRows['journal'],
    al1: (ir.data ?? []) as DrinkRows['al1'],
    substances: (su.data ?? []) as DrinkRows['substances'],
  };
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export { addDays };

// "Your normal" for a displayed number: median of the last 28 scored days before
// `day` (within 60 days, since WHOOP has gaps), needing at least 7. Display only;
// the analyses use their own stricter baseline.
export function normalBefore(rows: Cycle[], day: string, key: keyof Cycle): number | null {
  const from = addDays(day, -60);
  const vals = rows.filter((r) => r.wake_date < day && r.wake_date >= from && r[key] != null)
    .slice(-28).map((r) => Number(r[key])).sort((a, b) => a - b);
  if (vals.length < 7) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

export type DayLine = {
  day: string;
  checkins: number;          // check-in moments with an answer
  meals: number;             // food entries
  dinnerAt: string | null;   // ISO of the first dinner entry
  drinks: string | null;     // "1–2 drinks"
  sessions: string[];        // "Weightlifting 52 min"
};

// Same list as private.run_reminders() and send-nudge.mjs (compared lower-case, hyphens as spaces).
export const NOT_SESSIONS = new Set(['walking', 'race walking', 'activity', 'other', 'driving', 'increase_relaxation', 'meditation', 'sauna', 'ice bath']);

// Behaviour per day for the last `days` days (today included), newest first.
export async function getTimeline(today: string, days = 7): Promise<DayLine[]> {
  const from = addDays(today, -(days - 1));
  const [ir, fl, sl, wo] = await Promise.all([
    supabase.from('item_responses').select('wake_date,touchpoint,status').gte('wake_date', from).lte('wake_date', today),
    supabase.from('food_log').select('wake_date,slot,eaten_at,brand').gte('wake_date', from).lte('wake_date', today),
    supabase.from('substance_log').select('wake_date,substance,dose_bucket,alcohol_g').gte('wake_date', from).lte('wake_date', today),
    supabase.from('workouts').select('id,wake_date,sport_name,workout_start,workout_end,duration_minutes').gte('wake_date', from).lte('wake_date', today),
  ]);
  const out: DayLine[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(today, -i);
    const tps = new Set(((ir.data ?? []) as { wake_date: string; touchpoint: string | null; status: string }[])
      .filter((r) => r.wake_date === day && r.status === 'answered' && r.touchpoint).map((r) => r.touchpoint));
    // protein-powder rows (brand 'supplement') aren't meals
    const food = ((fl.data ?? []) as { wake_date: string; slot: string; eaten_at: string | null; brand: string | null }[])
      .filter((r) => r.wake_date === day && r.brand !== 'supplement');
    const dinner = food.filter((f) => f.slot === 'dinner' && f.eaten_at).map((f) => f.eaten_at as string).sort()[0] ?? null;
    const alc = ((sl.data ?? []) as { wake_date: string; substance: string; dose_bucket: string; alcohol_g: number | null }[])
      .filter((r) => r.wake_date === day && r.substance === 'alcohol');
    const ws = cleanWorkouts(((wo.data ?? []) as { wake_date: string; sport_name: string; workout_start: string; duration_minutes: number | null }[])
      .filter((w) => w.wake_date === day && !NOT_SESSIONS.has(w.sport_name.toLowerCase().replace(/-/g, ' '))));
    // One entry per sport: three cricket bouts read as "Cricket 87 min".
    const mins = new Map<string, number>();
    for (const w of ws) mins.set(w.sport_name, (mins.get(w.sport_name) ?? 0) + Number(w.duration_minutes ?? 0));
    out.push({
      day, checkins: tps.size, meals: food.length, dinnerAt: dinner,
      drinks: nightLabel(alc),
      sessions: [...mins].map(([sp, m]) => `${sp[0].toUpperCase()}${sp.slice(1).replace(/[-_]/g, ' ')} ${Math.round(m)} min`),
    });
  }
  return out;
}

export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");
export const hm = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

// What the day held, in a few words. Facts only; an empty day is a dash, never a count of misses.
export function dayFacts(d: DayLine | undefined, tz: string): string[] {
  if (!d) return [];
  const f: string[] = [...d.sessions];
  if (d.dinnerAt) f.push(`dinner ${hm(d.dinnerAt, tz)}`);
  if (d.drinks) f.push(d.drinks);
  if (d.checkins) f.push(`${d.checkins} check-in${d.checkins === 1 ? "" : "s"}`);
  return f;
}

