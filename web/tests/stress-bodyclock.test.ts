// Stress tests for lib/bodyClock.ts and stats.nightMinutes. Tests that FAIL here are
// findings (bugs or unclear definitions), left failing on purpose; see each name.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bodyClock, addDays, staleNote, wakeDateIn, MIN, type BodyClockRow } from '../lib/bodyClock.ts';
import { nightMinutes, weekIrregularityAt, wrapDev } from '../lib/stats.ts';

const TZ = 'Asia/Calcutta';
const IST = 330 * 60_000;
const real: BodyClockRow[] = JSON.parse(readFileSync(new URL('./fixtures/bodyclock-cycles.json', import.meta.url), 'utf8'));

// local IST clock "HH:MM" on `date` -> ISO instant
const at = (date: string, hm: string) => {
  const [h, m] = hm.split(':').map(Number), [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - IST).toISOString();
};
// a night: bed on the day before (or same day) at `bed`, wake on `wake` at `end`
const night = (wake: string, bed: string, end: string, bedDay: 'prev' | 'same' = 'prev'): BodyClockRow =>
  ({ wake_date: wake, sleep_start: at(bedDay === 'prev' ? addDays(wake, -1) : wake, bed), sleep_end: at(wake, end) });
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));
const regular = (from: string, n: number, bed = '23:00', end = '07:00') => days(from, n).map((d) => night(d, bed, end));
const dow = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();

// small deterministic PRNG so a failure reproduces
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

describe('nightMinutes (18:00 anchor)', () => {
  test('17:59 -> 1439, 18:00 -> 0, 18:01 -> 1', () => {
    assert.equal(nightMinutes(at('2026-03-10', '17:59'), TZ), 1439);
    assert.equal(nightMinutes(at('2026-03-10', '18:00'), TZ), 0);
    assert.equal(nightMinutes(at('2026-03-10', '18:01'), TZ), 1);
  });
  test('all-nighter 10:19 and 15:41 read late (979, 1301)', () => {
    assert.equal(nightMinutes(at('2026-03-10', '10:19'), TZ), 979);
    assert.equal(nightMinutes(at('2026-03-10', '15:41'), TZ), 1301);
  });
  test('always an integer in 0..1439 for random instants', () => {
    const r = rng(1);
    for (let i = 0; i < 2000; i++) {
      const v = nightMinutes(new Date(1.7e12 + r() * 3e10).toISOString(), TZ);
      assert.ok(Number.isInteger(v) && v >= 0 && v < 1440, String(v));
    }
  });
  test('a +04:00 row is read as its instant in the SETTING tz (23:00+04:00 = 00:30 IST = 390)', () => {
    assert.equal(nightMinutes('2026-02-09T23:00:00+04:00', TZ), 390);
    assert.equal(nightMinutes('2026-02-09T19:00:00+00:00', TZ), 390);
  });
});

describe('properties', () => {
  test('identical nights -> SRI 100 (28 and 7 day)', () => {
    const b = bodyClock(regular('2026-01-01', 40), '2026-02-09', TZ);
    assert.equal(b.regularity.d28.value, 100);
    assert.equal(b.regularity.d7.value, 100);
  });

  test('SRI is -100 on exact opposite alternating schedules (the scale is -100..100, as in the literature)', () => {
    // even days asleep 18:00-06:00, odd days asleep 06:00-18:00 = exact complements
    const rows = days('2026-01-01', 40).map((d, i) => (i % 2 ? night(d, '06:00', '18:00', 'same') : night(d, '18:00', '06:00')));
    const b = bodyClock(rows, '2026-02-09', TZ);
    assert.ok(b.regularity.d28.value !== null);
    assert.equal(b.regularity.d28.value, -100);
  });

  test('opposite alternating schedules give a low SRI (<= 0)', () => {
    const rows = days('2026-01-01', 40).map((d, i) => (i % 2 ? night(d, '06:00', '18:00', 'same') : night(d, '18:00', '06:00')));
    assert.ok(bodyClock(rows, '2026-02-09', TZ).regularity.d28.value! <= 0);
  });

  test('SRI never leaves -100..100 and shifting every night by the same amount leaves it unchanged', () => {
    const r = rng(7);
    for (let t = 0; t < 30; t++) {
      const spec = days('2026-01-01', 45).map(() => ({ bed: 21 * 60 + Math.floor(r() * 240), dur: 360 + Math.floor(r() * 180), skip: r() < 0.1 }));
      const build = (shift: number) => days('2026-01-01', 45).flatMap((d, i) => {
        if (spec[i].skip) return [];
        const bedMin = spec[i].bed + shift; // minutes after 00:00 of the day before wake
        const s = Date.parse(at(addDays(d, -1), '00:00')) + bedMin * 60_000;
        return [{ wake_date: d, sleep_start: new Date(s).toISOString(), sleep_end: new Date(s + spec[i].dur * 60_000).toISOString() }];
      });
      const base = bodyClock(build(0), '2026-02-14', TZ).regularity;
      for (const v of [base.d28.value, base.d7.value]) assert.ok(v === null || (v >= -100 && v <= 100), `sri ${v}`);
      for (const shift of [-60, 45, 120, 180]) {
        const sh = bodyClock(build(shift), '2026-02-14', TZ).regularity;
        assert.equal(sh.d28.value, base.d28.value, `trial ${t} shift ${shift} d28`);
        assert.equal(sh.d7.value, base.d7.value, `trial ${t} shift ${shift} d7`);
      }
    }
  });

  test('a sleep that starts before 18:00 is not silently clipped (16:00 vs 18:00 starts should read < 100)', () => {
    const rows = days('2026-01-01', 40).map((d, i) => night(d, i % 2 ? '16:00' : '18:00', '02:00'));
    const v = bodyClock(rows, '2026-02-09', TZ).regularity.d28.value;
    assert.ok(v !== null && v < 100, `d28 = ${v} (the 2 h before 18:00 fall outside the window, so alternating 16:00/18:00 starts look identical)`);
  });

  test('on real data: SRI <= 100, week figure >= 0, window length = SDweek, nothing shown below its minimum, no future leak', () => {
    const dates = [...new Set(real.map((r) => r.wake_date))];
    for (const through of dates) {
      const b = bodyClock(real, through, TZ);
      for (const m of [b.regularity.d28, b.regularity.d7, b.regularity.d28WeekAgo]) {
        if (m.value !== null) { assert.ok(m.value >= -100 && m.value <= 100, `${through} sri ${m.value}`); assert.ok(m.have >= m.need, through); }
      }
      if (b.thisWeek.value !== null) assert.ok(b.thisWeek.value >= 0 && b.thisWeek.have >= b.thisWeek.need, through);
      if (b.usualWeek.value !== null) assert.ok(b.usualWeek.value >= 0 && b.usualWeek.have >= b.usualWeek.need, through);
      if (b.usualMid.value !== null) assert.ok(b.usualMid.have >= b.usualMid.need, through);
      if (b.weekendShift.value !== null) assert.ok(b.weekendShift.have >= b.weekendShift.need, through);
      if (b.backOnTrack.value !== null) assert.ok(b.backOnTrack.have >= b.backOnTrack.need && b.backOnTrack.value.of >= MIN.wakeMornings, through);
      assert.equal(b.weekWord !== null, b.thisWeek.value !== null && b.usualWeek.value !== null, `${through} weekWord`);
      // natural window length must equal SDweek from the last-28 rows, computed here from the raw rows
      const w = b.naturalWindow.value;
      if (w) {
        const lo = addDays(through, -27);
        const rs = real.filter((r) => r.wake_date >= lo && r.wake_date <= through && r.sleep_start && r.sleep_end);
        const dur = (r: BodyClockRow) => (Date.parse(r.sleep_end!) - Date.parse(r.sleep_start!)) / 60_000;
        const f = rs.filter((r) => [0, 6].includes(dow(r.wake_date))).map(dur), k = rs.filter((r) => ![0, 6].includes(dow(r.wake_date))).map(dur);
        const avg = (v: number[]) => v.reduce((a, c) => a + c, 0) / v.length;
        assert.ok(Math.abs(w.end - w.start - (5 * avg(k) + 2 * avg(f)) / 7) < 1e-6, `${through} window length`);
      }
    }
    // no future leak: dropping rows after `through` changes nothing
    for (const through of dates.filter((_, i) => i % 23 === 0)) {
      const past = real.filter((r) => r.wake_date <= through);
      assert.deepEqual(bodyClock(past, through, TZ), bodyClock(real, through, TZ), `leak at ${through}`);
    }
  });

  test('random sparse data never throws or shows a value below its minimum; row order does not matter', () => {
    const r = rng(99);
    for (let t = 0; t < 60; t++) {
      const p = 0.15 + r() * 0.85;
      const rows = days('2026-01-01', 90).flatMap((d) => {
        if (r() > p) return [];
        const bed = 20 * 60 + Math.floor(r() * 600), dur = 120 + Math.floor(r() * 600);
        const s = Date.parse(at(addDays(d, -1), '00:00')) + bed * 60_000;
        return [{ wake_date: d, sleep_start: new Date(s).toISOString(), sleep_end: new Date(s + dur * 60_000).toISOString() }];
      });
      const through = addDays('2026-01-01', 60 + Math.floor(r() * 30));
      const b = bodyClock(rows, through, TZ);
      for (const m of [b.usualMid, b.thisWeek, b.usualWeek, b.weekendShift, b.backOnTrack, b.naturalWindow, b.regularity.d28, b.regularity.d7, b.regularity.d28WeekAgo])
        assert.ok(m.value === null || m.have >= m.need, `trial ${t} shows below minimum: ${JSON.stringify(m)}`);
      if (b.thisWeek.value !== null) assert.ok(b.thisWeek.value >= 0);
      const shuffled = [...rows].sort(() => r() - 0.5);
      assert.deepEqual(bodyClock(shuffled, through, TZ), b, `trial ${t} order`);
    }
  });
});

describe('edge cases', () => {
  test('all-nighter 10:19-15:41 reads as a late night (+600 from usual 06:00), not an error', () => {
    const rows = [...regular('2026-01-01', 40), { wake_date: '2026-02-09', sleep_start: at('2026-02-09', '10:19'), sleep_end: at('2026-02-09', '15:41') }];
    const b = bodyClock(rows, '2026-02-09', TZ);
    assert.equal(b.strip[6].dev, 1140 - 540);
    assert.ok(b.regularity.d7.value !== null);
  });

  test('midpoint is continuous across 18:00 (sleep centred 17:30 vs 18:30 should be ~60 min apart, not ~1380)', () => {
    const mk = (bed: string, end: string) => bodyClock([...regular('2026-01-01', 40), night('2026-02-09', bed, end, 'same')].map((r) => r), '2026-02-09', TZ).strip[6].dev!;
    const before = mk('13:30', '21:30'); // midpoint 17:30
    const after = mk('14:30', '22:30'); // midpoint 18:30
    assert.ok(Math.abs(after - before) <= 90, `dev ${before} vs ${after}: the wrap at 18:00 splits one kind of sleep into opposite ends of the scale`);
  });

  test('a main sleep 17:30-20:00 (midpoint 18:45) vs usual 03:00 is 8 h 15 earlier on the clock (-495), the shorter way round', () => {
    const rows = regular('2026-01-01', 40).map((r) => (r.wake_date === '2026-02-05' ? night('2026-02-05', '17:30', '20:00', 'same') : r));
    const dev = bodyClock(rows, '2026-02-09', TZ).strip[2].dev!;
    assert.equal(dev, -495); // 18:45 is 8 h 15 before 03:00 and 15 h 45 after it; the wrap picks the shorter
  });

  test('16:00-02:00 sleep: midpoint 21:00 reads 180 (-360 vs usual 540), SRI still computed', () => {
    const rows = regular('2026-01-01', 40).map((r) => (r.wake_date === '2026-02-05' ? night('2026-02-05', '16:00', '02:00') : r));
    const b = bodyClock(rows, '2026-02-09', TZ);
    assert.equal(b.strip[2].dev, -360);
    assert.ok(b.regularity.d7.value !== null && b.regularity.d7.value < 100);
  });

  test('null sleep_start / sleep_end / garbage / zero-length are skipped, not zero', () => {
    for (const bad of [{ sleep_end: null }, { sleep_start: null }, { sleep_start: 'garbage' }, { sleep_end: at('2026-02-08', '23:00') }]) {
      const rows = regular('2026-01-01', 40).map((r) => (r.wake_date === '2026-02-09' ? { ...r, ...bad } : r));
      const b = bodyClock(rows, '2026-02-09', TZ);
      assert.equal(b.strip[6].dev, null, JSON.stringify(bad));
      assert.equal(b.thisWeek.have, 6);
    }
  });

  test('empty input: every metric null, nothing throws', () => {
    const b = bodyClock([], '2026-02-09', TZ);
    assert.equal(b.usualMid.value, null); assert.equal(b.regularity.d28.value, null);
    assert.equal(b.naturalWindow.value, null); assert.equal(b.weekWord, null);
    assert.equal(b.strip.length, 7);
  });

  // Duplicate wake_dates are not tested: cycles has a unique key on wake_date, so the DB never returns them.

  test('a missing night inside the window is never paired across the gap', () => {
    const full = bodyClock(regular('2026-01-01', 40), '2026-02-09', TZ).regularity;
    const gap = bodyClock(regular('2026-01-01', 40).filter((r) => r.wake_date !== '2026-02-05'), '2026-02-09', TZ).regularity;
    assert.equal(full.d7.have, 7); assert.equal(gap.d7.have, 5); // 7 pairs minus the two touching the gap
    assert.equal(full.d28.have, 27); assert.equal(gap.d28.have, 25);
    // a gap night that WOULD disagree if paired across the gap (day 4 vs day 6) must not change the value
    const rows = days('2026-01-01', 40).flatMap((d) => (d === '2026-02-05' ? [] : [d === '2026-02-04' ? night(d, '01:00', '09:00', 'same') : night(d, '23:00', '07:00')]));
    const b = bodyClock(rows, '2026-02-09', TZ).regularity.d7;
    assert.equal(b.have, 5);
    assert.equal(b.value, 93); // only the 3-4 pair disagrees (5/6 agreement); a 4-vs-6 pairing would add a sixth pair
  });

  test('+04:00 travel nights are the same instants as UTC and judged on the home (setting-tz) clock', () => {
    const asUtc = regular('2026-01-01', 40);
    const asPlus4 = asUtc.map((r) => ({ ...r, sleep_start: new Date(r.sleep_start!).toISOString().replace('Z', '+00:00'), sleep_end: r.sleep_end }));
    assert.deepEqual(bodyClock(asPlus4, '2026-02-09', TZ), bodyClock(asUtc, '2026-02-09', TZ));
    // the same wall-clock 23:00-07:00 at +04:00 is 00:30-08:30 IST: one displaced night = +90 min vs usual
    const trav = regular('2026-01-01', 40).map((r) => (r.wake_date === '2026-02-09' ? { ...r, sleep_start: '2026-02-08T23:00:00+04:00', sleep_end: '2026-02-09T07:00:00+04:00' } : r));
    assert.equal(bodyClock(trav, '2026-02-09', TZ).strip[6].dev, 90);
  });

  test('Sunday->Monday: weekend = wake_date Sat/Sun; the Sunday-night sleep (Monday wake_date) is a work night', () => {
    // through = Sun 2026-02-08, 40 nights; Sat/Sun wake nights go to bed 2 h later
    const mk = (through: string, lateOn: number[]) => days(addDays(through, -45), 46).map((d) => (lateOn.includes(dow(d)) ? night(d, '01:00', '09:00', 'same') : night(d, '23:00', '07:00')));
    const sun = bodyClock(mk('2026-02-08', [0, 6]), '2026-02-08', TZ);
    assert.equal(sun.weekendShift.value, 120);
    const mon = bodyClock(mk('2026-02-09', [0, 6]), '2026-02-09', TZ); // Monday: still 4+ of each in 28 days
    assert.equal(mon.weekendShift.value, 120);
    // only Sunday wake_dates late: 4 Sat on time + 4 Sun late -> median +60; only Monday wake_dates late (Sunday-night sleeps): no weekend effect
    assert.equal(bodyClock(mk('2026-02-09', [0]), '2026-02-09', TZ).weekendShift.value, 60);
    assert.equal(bodyClock(mk('2026-02-09', [1]), '2026-02-09', TZ).weekendShift.value, 0);
  });
});

describe('thresholds (14/13, 5/4, 4/3, 8/7)', () => {
  test('usual midpoint: 14 nights shows, 13 does not', () => {
    assert.ok(bodyClock(regular('2026-01-20', 14), '2026-02-02', TZ).usualMid.value !== null);
    const b13 = bodyClock(regular('2026-01-20', 13), '2026-02-01', TZ);
    assert.equal(b13.usualMid.value, null); assert.equal(b13.usualMid.have, 13);
  });

  test('week figure: 5 nights in the week shows, 4 does not', () => {
    const through = '2026-02-14';
    for (const [keep, shown] of [[5, true], [4, false]] as const) {
      const drop = days(addDays(through, -6), 7).slice(0, 7 - keep);
      const rows = regular('2026-01-01', 60).filter((r) => !drop.includes(r.wake_date));
      const t = bodyClock(rows, through, TZ).thisWeek;
      assert.equal(t.value !== null, shown, `keep ${keep}: ${JSON.stringify(t)}`);
      assert.equal(t.have, keep);
    }
  });

  // through = Sun 2026-02-08: 28-day window Jan 12..Feb 8 holds 8 free (Sat/Sun) and 20 work dates
  const free = days('2026-01-12', 28).filter((d) => [0, 6].includes(dow(d))), work = days('2026-01-12', 28).filter((d) => ![0, 6].includes(dow(d)));
  const mkFW = (f: number, w: number) => [...free.slice(0, f), ...work.slice(0, w)].map((d) => night(d, '23:00', '07:00'));
  test('weekend shift and natural window: 4 free + 8 work shows', () => {
    const b = bodyClock(mkFW(4, 8), '2026-02-08', TZ);
    assert.ok(b.weekendShift.value !== null && b.naturalWindow.value !== null);
  });
  test('3 free nights: both null and name "weekend nights"', () => {
    const b = bodyClock(mkFW(3, 20), '2026-02-08', TZ);
    assert.equal(b.weekendShift.value, null); assert.equal(b.weekendShift.of, 'weekend nights'); assert.equal(b.weekendShift.have, 3);
    assert.equal(b.naturalWindow.value, null); assert.equal(b.naturalWindow.of, 'weekend nights');
  });
  test('7 work nights: both null and name "work nights" (need 8, have 7)', () => {
    const b = bodyClock(mkFW(8, 7), '2026-02-08', TZ);
    assert.equal(b.weekendShift.value, null); assert.equal(b.weekendShift.of, 'work nights');
    assert.equal(b.weekendShift.have, 7); assert.equal(b.weekendShift.need, 8);
    assert.equal(b.naturalWindow.value, null); assert.equal(b.naturalWindow.of, 'work nights');
  });
  test('natural window length equals SDweek exactly (free 9 h, work 7 h -> 454.29 min) and MSFsc is sleep-debt corrected', () => {
    const rows = [...free.map((d) => night(d, '23:00', '08:00')), ...work.map((d) => night(d, '23:00', '06:00'))];
    const w = bodyClock(rows, '2026-02-08', TZ).naturalWindow.value!;
    assert.ok(Math.abs(w.end - w.start - (5 * 420 + 2 * 540) / 7) < 1e-9);
    const msf = nightMinutes(at('2026-02-08', '03:30'), TZ); // free midpoint 03:30 + ... 23:00-08:00 -> 03:30
    assert.ok(Math.abs(w.msfsc - (msf - (540 - (5 * 420 + 2 * 540) / 7) / 2)) < 1e-9);
  });
  test('back on track: needs 14 nights and 5 of the last 7 mornings', () => {
    const through = '2026-02-14';
    assert.ok(bodyClock(regular(addDays(through, -13), 14), through, TZ).backOnTrack.value !== null);
    assert.equal(bodyClock(regular(addDays(through, -12), 13), through, TZ).backOnTrack.value, null);
    // 4 of the last 7 present, 24 earlier: still null
    const rows = regular(addDays(through, -27), 28).filter((r) => r.wake_date < addDays(through, -3) || r.wake_date > through);
    const b = bodyClock(rows.filter((r) => !['2026-02-12', '2026-02-13', '2026-02-14'].includes(r.wake_date) || false), through, TZ);
    assert.equal(b.backOnTrack.value, null);
  });
});

describe('staleNote', () => {
  test('last night = yesterday -> null; 2 days old -> note; today -> null', () => {
    assert.equal(staleNote('2026-10-16', '2026-10-17'), null);
    assert.equal(staleNote('2026-10-17', '2026-10-17'), null);
    assert.equal(staleNote('2026-10-15', '2026-10-17'), 'Last night synced: 15 Oct');
  });
  test('month and year boundaries, future dates, garbage', () => {
    assert.equal(staleNote('2026-12-30', '2027-01-01'), 'Last night synced: 30 Dec');
    assert.equal(staleNote('2026-12-31', '2027-01-01'), null);
    assert.equal(staleNote('2026-10-20', '2026-10-17'), null);
  });
  test('garbage lastWake must not render "Last night synced: NaN undefined"', () => {
    const s = staleNote('bad-date', '2026-10-17');
    assert.ok(s === null || !/NaN|undefined/.test(s), String(s));
  });

  // BodyClockParts calls staleNote(last.wake_date, wakeDate()); wakeDate (lib/day.ts) uses the DEVICE clock
  // with a 04:00 boundary. day.ts can't be imported under node (extensionless './settings'), so lift its body.
  const src = readFileSync(new URL('../lib/day.ts', import.meta.url), 'utf8');
  const body = /export function wakeDate\(now: Date = new Date\(\)\): string \{([\s\S]*?)\n\}/.exec(src)?.[1];
  const wakeDate = new Function('now', `now = now || new Date();${body!.replace(/const d = new Date\(now\)/, 'const d = new Date(now)')}`) as (n: Date) => string;

  test('near midnight: 00:30 and 03:59 still belong to the previous wake day; 04:00 starts the new one', () => {
    const prev = process.env.TZ; process.env.TZ = TZ;
    try {
      assert.equal(wakeDate(new Date(at('2026-10-18', '00:30'))), '2026-10-17');
      assert.equal(wakeDate(new Date(at('2026-10-18', '03:59'))), '2026-10-17');
      assert.equal(wakeDate(new Date(at('2026-10-18', '04:00'))), '2026-10-18');
      // last synced night 16 Oct, viewed 00:30 on the 18th: today = 17th, so yesterday = 16th -> no note
      assert.equal(staleNote('2026-10-16', wakeDate(new Date(at('2026-10-18', '00:30')))), null);
      // the same night viewed at 04:00 the 18th: now 2 days old -> note appears
      assert.ok(staleNote('2026-10-16', wakeDate(new Date(at('2026-10-18', '04:00')))) !== null);
    } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
  });

  test('device tz differing from the tz setting does not change the verdict (stale note reads the setting)', () => {
    const instant = new Date('2026-10-17T20:00:00Z'); // 01:30 on 18 Oct in Calcutta = still wake day 17 Oct
    const prev = process.env.TZ;
    const verdict = (deviceTz: string) => { process.env.TZ = deviceTz; return staleNote('2026-10-16', wakeDateIn(TZ, instant)); };
    try {
      const home = verdict(TZ), away = verdict('Pacific/Auckland');
      assert.equal(home, null);
      assert.equal(away, home, `Calcutta device: ${home}; Auckland device: ${away}`);
    } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
  });

  test('wakeDateIn: 04:00 boundary in the given tz', () => {
    assert.equal(wakeDateIn(TZ, new Date(at('2026-10-18', '03:59'))), '2026-10-17');
    assert.equal(wakeDateIn(TZ, new Date(at('2026-10-18', '04:00'))), '2026-10-18');
    assert.equal(wakeDateIn('America/New_York', new Date('2026-10-18T07:59:00Z')), '2026-10-17'); // 03:59 EDT
  });
});

describe('fixes from the stress findings', () => {
  test('wrapDev wraps into (-720, +720]', () => {
    assert.equal(wrapDev(720), 720); assert.equal(wrapDev(-720), 720); assert.equal(wrapDev(721), -719);
    assert.equal(wrapDev(870), -570); assert.equal(wrapDev(-510), -510); assert.equal(wrapDev(0), 0);
  });
  test('a night about 9 h earlier than usual reads -540, not +14 h', () => {
    // usual midpoint 03:00 (23:00-07:00); a sleep centred 18:00 is 9 h earlier = 540 min after usual wrapped
    const rows = regular('2026-01-01', 40).map((r) => (r.wake_date === '2026-02-05' ? night('2026-02-05', '14:00', '22:00', 'same') : r));
    const dev = bodyClock(rows, '2026-02-09', TZ).strip[2].dev!;
    assert.equal(dev, -540 + 0 * dev);
  });
  test('weekIrregularityAt uses the wrapped deviation (H2 tests share it)', () => {
    // usual 100 (minutes since 18:00); a night at 1400 is 1300 later linearly, but 140 earlier on the clock
    const mids = Array.from({ length: 40 }, () => 100 as number | null);
    for (let j = 33; j < 40; j++) mids[j] = 1400;
    assert.equal(weekIrregularityAt(mids, 39).value, 140);
  });
  test('SRI counts a sleep that starts before 18:00 in the day before\'s window too', () => {
    const rows = days('2026-01-01', 40).map((d, i) => night(d, i % 2 ? '16:00' : '18:00', '02:00'));
    assert.ok(bodyClock(rows, '2026-02-09', TZ).regularity.d28.value! < 100);
  });
  test('still-learning lines agree: 13 nights -> every row that needs nights says 14 and have 13', () => {
    const b = bodyClock(regular('2026-01-20', 13), '2026-02-01', TZ);
    for (const m of [b.usualMid, b.thisWeek, b.backOnTrack]) assert.deepEqual([m.have, m.need], [13, 14]);
  });
  test('14 nights but only 3 mornings in the last week: back on track and this week both name this week', () => {
    const through = '2026-02-14';
    const rows = regular(addDays(through, -30), 31).filter((r) => r.wake_date <= addDays(through, -7) || r.wake_date >= addDays(through, -2));
    const b = bodyClock(rows, through, TZ);
    assert.deepEqual([b.backOnTrack.have, b.backOnTrack.need, b.backOnTrack.of], [3, 5, 'mornings this week']);
    assert.deepEqual([b.thisWeek.have, b.thisWeek.need, b.thisWeek.of], [3, 5, 'nights this week']);
  });
});
