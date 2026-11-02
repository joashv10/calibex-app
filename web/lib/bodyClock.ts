// Body clock: how regular sleep timing is. Pure module (no I/O); everything is
// minutes, computed from WHOOP sleep start/end and never stored.
//
// Clock times are "minutes since 18:00 local" (stats.nightMinutes), 0..1439, so
// a night is continuous and a daytime sleep reads late. `through` is the wake_date
// of the last night to include (inclusive). Every figure is null below its
// minimum, with what's missing, so the UI says "still learning" and never shows
// a number it can't stand behind.
//
// Every "away from usual" figure is circular: the deviation wraps into (-720, +720]
// (stats.wrapDev), so the 18:00 seam of the scale never splits one kind of sleep in two.

import { nightMinutes, normalAt, weekIrregularityAt, wrapDev, type CycleRow } from './stats.ts';

export type BodyClockRow = Pick<CycleRow, 'wake_date' | 'sleep_start' | 'sleep_end'>;

// A figure and what it needs: value is null (and `have` < `need`) when below the minimum.
// `of` names the group when it isn't plain nights (e.g. the work nights a weekend figure also needs).
export type Metric<T> = { value: T | null; have: number; need: number; of?: string };

export type WeekWord = 'Unsettled week' | 'Steadier than usual' | 'A usual week';

export type StripNight = { date: string; dow: string; dev: number | null };

export type BodyClock = {
  usualMid: Metric<number>; // minutes since 18:00
  thisWeek: Metric<number>; // median |midpoint - usual|, last 7 nights
  usualWeek: Metric<number>; // median of earlier weekly figures; need = weeks
  weekWord: WeekWord | null;
  weekendShift: Metric<number>; // signed minutes, Sat/Sun wake minus other nights
  backOnTrack: Metric<{ usualWake: number; within: number; of: number }>;
  naturalWindow: Metric<{ start: number; end: number; msfsc: number }>;
  regularity: {
    d28: Metric<number>; // SRI -100..100 (100 = identical every day, 0 = chance), last 28 days
    d7: Metric<number>; // last 7 days
    d28WeekAgo: Metric<number>; // the 28-day value as of 7 days earlier
  };
  strip: StripNight[]; // last 7 calendar days, signed deviation from usual
};

export const MIN = {
  usualNights: 14, weekNights: 5, weeks: 4, freeNights: 4, workNights: 8,
  wakeNights: 14, wakeMornings: 5, sriPairs28: 14, sriPairs7: 4,
} as const;
const WINDOW = 28;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── calendar helpers (YYYY-MM-DD, UTC arithmetic) ─────────────────────────

const dayMs = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const msDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => msDay(dayMs(s) + n * 86_400_000);
const dowOf = (s: string) => new Date(dayMs(s)).getUTCDay();
const isFree = (s: string) => { const d = dowOf(s); return d === 0 || d === 6; };

// Absolute ms of local `hour`:00 on `date` in tz (re-checked once so a DST day is right).
function localToMs(date: string, hour: number, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
  const offsetAt = (ms: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60_000) * 60_000;
  };
  const wall = dayMs(date) + hour * 3_600_000;
  let ms = wall - offsetAt(wall);
  ms = wall - offsetAt(ms);
  return ms;
}

// ─── small stats ────────────────────────────────────────────────────────────

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
// Linear-interpolated quantile (type 7), q in 0..1.
function quantile(v: number[], q: number): number {
  const s = [...v].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
const metric = <T,>(value: T | null, have: number, need: number): Metric<T> => ({ value: have >= need ? value : null, have, need });

// ─── nights ─────────────────────────────────────────────────────────────────

type Night = { date: string; startMs: number; endMs: number; mid: number; wake: number; dur: number };

function toNights(rows: BodyClockRow[], tz: string): Map<string, Night> {
  const out = new Map<string, Night>();
  for (const r of rows) {
    if (!r.sleep_start || !r.sleep_end) continue;
    const startMs = Date.parse(r.sleep_start), endMs = Date.parse(r.sleep_end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    out.set(r.wake_date, {
      date: r.wake_date, startMs, endMs, dur: (endMs - startMs) / 60_000,
      mid: nightMinutes(new Date((startMs + endMs) / 2).toISOString(), tz),
      wake: nightMinutes(r.sleep_end, tz),
    });
  }
  return out;
}

// The 28 calendar days before index i of a null-filled series -> normalAt (same
// window and minimum as stats.normalAt, so "usual" means one thing app-wide).
function seriesOver(from: string, to: string, f: (d: string) => number | null): { dates: string[]; s: (number | null)[] } {
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return { dates, s: dates.map(f) };
}

// Sleep Regularity Index over the days [from..through]: pairs of consecutive
// calendar days that both have a night, compared minute by minute over the 24 h
// from 18:00 local, using absolute sleep start/end. 100 = identical every day,
// 0 = no better than chance, -100 = exact opposites (so -100..100, as in the literature).
// A sleep is marked asleep in every 24 h window it touches, so one that starts before
// 18:00 counts in the day before's window too (not clipped at the window edge).
function sri(nights: Map<string, Night>, from: string, through: string, tz: string): { value: number | null; pairs: number } {
  // asleep[k] for the window starting at ms `w`: minute k is asleep in any night near day d
  const windowOf = (d: string): Uint8Array => {
    const w = localToMs(addDays(d, -1), 18, tz);
    const out = new Uint8Array(1440);
    for (const day of [addDays(d, -1), d, addDays(d, 1)]) {
      const n = nights.get(day);
      if (!n) continue;
      const lo = Math.max(0, Math.ceil((n.startMs - w) / 60_000)), hi = Math.min(1440, Math.ceil((n.endMs - w) / 60_000));
      for (let k = lo; k < hi; k++) out[k] = 1;
    }
    return out;
  };
  let agree = 0, pairs = 0;
  for (let d = from; d < through; d = addDays(d, 1)) {
    if (!nights.get(d) || !nights.get(addDays(d, 1))) continue;
    const sa = windowOf(d), sb = windowOf(addDays(d, 1));
    let same = 0;
    for (let k = 0; k < 1440; k++) if (sa[k] === sb[k]) same++;
    agree += same / 1440;
    pairs++;
  }
  return { value: pairs ? Math.round(200 * (agree / pairs) - 100) : null, pairs };
}

export function bodyClock(rows: BodyClockRow[], through: string, tz: string): BodyClock {
  const nights = toNights(rows, tz);
  const first = addDays(through, -(WINDOW + 7 + 7 * 40)); // enough history for earlier weeks
  const mids = seriesOver(first, addDays(through, 1), (d) => nights.get(d)?.mid ?? null);
  const idx = (d: string) => mids.dates.indexOf(d);
  const win = (days: number) => { const out: Night[] = []; for (let i = 0; i < days; i++) { const n = nights.get(addDays(through, -i)); if (n) out.push(n); } return out; };
  const last28 = win(WINDOW);

  // usual midpoint: median of the prior 28 calendar days (normalAt, min 14), through `through`.
  const usualMid = metric(normalAt(mids.s, idx(addDays(through, 1))), last28.length, MIN.usualNights);

  // the week figure: median |midpoint − that night's own usual| over the 7 nights ending
  // at `end` (stats.weekIrregularityAt, shared with the H2b test)
  const weekFigure = (end: string): { v: number | null; n: number } => {
    const r = weekIrregularityAt(mids.s, idx(end), MIN.weekNights);
    return { v: r.value, n: r.have };
  };
  const tw = weekFigure(through);
  // Below the nights "usual" needs, say so in the usual's own count (it is what is missing);
  // otherwise count the nights this week that have a usual.
  const thisWeek: Metric<number> = last28.length < MIN.usualNights
    ? { value: null, have: last28.length, need: MIN.usualNights }
    : { ...metric(tw.v, tw.n, MIN.weekNights), of: 'nights this week' };

  const earlier: number[] = [];
  for (let k = 1; k <= 40; k++) { const f = weekFigure(addDays(through, -7 * k)); if (f.v !== null) earlier.push(f.v); }
  const usualWeek = metric(earlier.length ? median(earlier) : null, earlier.length, MIN.weeks);
  let weekWord: WeekWord | null = null;
  if (thisWeek.value !== null && usualWeek.value !== null) {
    weekWord = thisWeek.value > quantile(earlier, 0.75) ? 'Unsettled week'
      : thisWeek.value < quantile(earlier, 0.25) ? 'Steadier than usual' : 'A usual week';
  }

  // weekend shift (28 nights): median midpoint of Sat/Sun wake nights minus the rest
  const free = last28.filter((n) => isFree(n.date)), work = last28.filter((n) => !isFree(n.date));
  // Both groups need their minimum; when it's short, report the group that is short.
  const groupShort = (): Metric<never> => free.length < MIN.freeNights
    ? { value: null, have: free.length, need: MIN.freeNights, of: 'weekend nights' }
    : { value: null, have: work.length, need: MIN.workNights, of: 'work nights' };
  const enough = free.length >= MIN.freeNights && work.length >= MIN.workNights;
  const weekendShift: Metric<number> = enough
    ? metric(wrapDev(median(free.map((n) => n.mid)) - median(work.map((n) => n.mid))), free.length, MIN.freeNights)
    : groupShort();

  // back on track: usual wake = median wake of the prior 28; mornings within 30 min among the last 7
  const wakes = seriesOver(first, addDays(through, 1), (d) => nights.get(d)?.wake ?? null);
  const usualWake = normalAt(wakes.s, wakes.dates.indexOf(addDays(through, 1)));
  const lastWeek = win(7);
  // Short on nights overall -> the same "14 nights" every other row says; otherwise the mornings this week.
  const backOnTrack: Metric<{ usualWake: number; within: number; of: number }> =
    last28.length < MIN.wakeNights ? { value: null, have: last28.length, need: MIN.wakeNights }
    : lastWeek.length < MIN.wakeMornings ? { value: null, have: lastWeek.length, need: MIN.wakeMornings, of: 'mornings this week' }
    : metric(
      usualWake === null ? null : { usualWake, within: lastWeek.filter((n) => Math.abs(wrapDev(n.wake - usualWake)) <= 30).length, of: lastWeek.length },
      last28.length, MIN.wakeNights);

  // natural window (Munich chronotype, MSFsc)
  let naturalWindow: Metric<{ start: number; end: number; msfsc: number }> = enough ? { value: null, have: free.length, need: MIN.freeNights } : groupShort();
  if (enough) {
    const sdf = mean(free.map((n) => n.dur)), sdw = mean(work.map((n) => n.dur));
    const sdweek = (5 * sdw + 2 * sdf) / 7;
    const ref = median(free.map((n) => n.mid)); // mean taken around the median, so a seam-crossing night doesn't drag it
    const msf = ref + mean(free.map((n) => wrapDev(n.mid - ref)));
    const msfsc = sdf > sdw ? msf - (sdf - sdweek) / 2 : msf;
    naturalWindow = { value: { start: msfsc - sdweek / 2, end: msfsc + sdweek / 2, msfsc }, have: free.length, need: MIN.freeNights };
  }

  // sleep regularity (SRI)
  const sriAt = (end: string, need: number) => { const r = sri(nights, addDays(end, -(WINDOW - 1)), end, tz); return metric(r.value, r.pairs, need); };
  // last 7: the 7 pairs whose second day is one of the last 7 nights
  const r7 = sri(nights, addDays(through, -7), through, tz);
  const regularity = {
    d28: sriAt(through, MIN.sriPairs28),
    d7: metric(r7.value, r7.pairs, MIN.sriPairs7),
    d28WeekAgo: sriAt(addDays(through, -7), MIN.sriPairs28),
  };

  const strip: StripNight[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(through, -i);
    strip.push({ date: d, dow: DOW[dowOf(d)], dev: usualMid.value === null ? null : (nights.get(d) ? wrapDev(nights.get(d)!.mid - usualMid.value) : null) });
  }

  return { usualMid, thisWeek, usualWeek, weekWord, weekendShift, backOnTrack, naturalWindow, regularity, strip };
}

// minutes since 18:00 -> "HH:MM"
export const clockLabel = (min: number) => {
  const t = (((Math.round(min) + 1080) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

// Today's wake date in the user's tz setting (a time before 04:00 still belongs to the day
// before, the same rule as lib/day.wakeDate, which reads the device clock instead).
export function wakeDateIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now.getTime() - 4 * 3_600_000));
}

// The week ends at the last synced night. When that is older than yesterday's wake date
// (`today` is today's wake date), say so: "Last night synced: 14 Oct". Null when current.
export function staleNote(lastWake: string, today: string): string | null {
  if (lastWake >= addDays(today, -1)) return null;
  const [, m, d] = lastWake.split('-').map(Number);
  return `Last night synced: ${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
}
