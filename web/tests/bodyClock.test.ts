import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bodyClock, clockLabel, staleNote, type BodyClockRow } from '../lib/bodyClock.ts';

const TZ = 'Asia/Calcutta';
// Synthetic nights (wake_date, sleep_start, sleep_end), Jul to 16 Oct 2026: seeded random, later at weekends,
// unsettled in the last week, one gap, a daytime sleep on the last night. The expected figures below are
// regression values for this fixture, not hand-derived.
const rows: BodyClockRow[] = JSON.parse(readFileSync(new URL('./fixtures/bodyclock-cycles.json', import.meta.url), 'utf8'));
// "As of 17 Oct" = nights through the 16th.
const b = bodyClock(rows, '2026-10-16', TZ);
const near = (got: number | null | undefined, want: number, tol: number, what: string) =>
  assert.ok(got != null && Math.abs(got - want) <= tol, `${what}: got ${got}, want ${want} ±${tol}`);

describe('bodyClock on the fixture', () => {
  test('usual midpoint 06:29', () => assert.equal(clockLabel(b.usualMid.value!), '06:29'));
  test('this week ±54, usual week about ±35, unsettled', () => {
    near(b.thisWeek.value, 54.5, 2, 'thisWeek');
    near(b.usualWeek.value, 35.25, 2, 'usualWeek');
    assert.equal(b.weekWord, 'Unsettled week');
  });
  test('weekend shift +52', () => near(b.weekendShift.value, 52, 2, 'weekend'));
  test('back on track: usual wake 10:29, 2 of 7', () => {
    assert.equal(clockLabel(b.backOnTrack.value!.usualWake), '10:29');
    assert.equal(b.backOnTrack.value!.within, 2);
    assert.equal(b.backOnTrack.value!.of, 7);
  });
  test('natural window starts 09:23, centre 12:58', () => {
    const w = b.naturalWindow.value!;
    near(w.start, 563.4, 2, 'start');
    near(w.msfsc, 778.3, 2.5, 'msfsc');
    near(w.end, 993.2, 5.5, 'end');
  });
  test('regularity 77 / 65 / 81', () => {
    assert.equal(b.regularity.d28.value, 77);
    near(b.regularity.d7.value, 65, 2, 'sri7');
    assert.equal(b.regularity.d28WeekAgo.value, 81);
  });
  test('strip: 7 nights, 16 Oct (daytime sleep) is +391', () => {
    assert.equal(b.strip.length, 7);
    assert.equal(b.strip[6].date, '2026-10-16');
    assert.equal(b.strip[6].dev, 391);
  });
});

describe('bodyClock gaps and minimums', () => {
  test('too few nights: every figure is null and says what is missing', () => {
    const few = bodyClock(rows.filter((r) => r.wake_date >= '2026-10-08'), '2026-10-16', TZ);
    assert.equal(few.usualMid.value, null);
    assert.equal(few.usualMid.need, 14);
    assert.ok(few.usualMid.have < 14 && few.usualMid.have > 0);
    assert.equal(few.regularity.d28.value, null);
    assert.equal(few.weekWord, null);
    assert.equal(few.backOnTrack.value, null);
  });
  test('a missing night is skipped and never paired across the gap', () => {
    const gappy = rows.filter((r) => r.wake_date !== '2026-10-12');
    const g = bodyClock(gappy, '2026-10-16', TZ);
    assert.equal(g.regularity.d28.have, 25); // 27 pairs minus the two touching the gap
    assert.equal(g.strip[2].dev, null);
  });
  test('a row without sleep_end is not a night', () => {
    const g = bodyClock(rows.map((r) => (r.wake_date === '2026-10-12' ? { ...r, sleep_end: null } : r)), '2026-10-16', TZ);
    assert.equal(g.strip[2].dev, null);
  });
  test('week word follows computed quartiles, not fixed numbers', () => {
    // identical jitter every week -> this week is neither above Q3 nor below Q1
    const out: BodyClockRow[] = [];
    for (let i = 0; i < 70; i++) {
      const day = new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10);
      const shift = (i % 7) * 10 * 60_000; // same pattern each week
      out.push({ wake_date: day, sleep_start: new Date(Date.parse(`${day}T00:00:00Z`) + shift).toISOString(), sleep_end: new Date(Date.parse(`${day}T06:00:00Z`) + shift).toISOString() });
    }
    const steady = bodyClock(out, out[69].wake_date, 'UTC');
    assert.equal(steady.weekWord, 'A usual week');
  });
});

describe('weekend figures need both groups', () => {
  // Nights at 23:00-07:00 IST on the given wake dates.
  const mk = (dates: string[]): BodyClockRow[] => dates.map((d) => {
    const prev = new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    return { wake_date: d, sleep_start: `${prev}T17:30:00Z`, sleep_end: `${d}T01:30:00Z` };
  });
  const days: string[] = [];
  for (let t = Date.parse('2026-09-19T00:00:00Z'); t <= Date.parse('2026-10-16T00:00:00Z'); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  const weekend = days.filter((d) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
  const weekdays = days.filter((d) => !weekend.includes(d));

  test('4+ weekend nights but 1 work night: no natural window, no weekend shift, and it names work nights', () => {
    const few = bodyClock(mk([...weekend, weekdays[weekdays.length - 1]]), '2026-10-16', TZ);
    assert.equal(few.naturalWindow.value, null);
    assert.equal(few.weekendShift.value, null);
    for (const m of [few.naturalWindow, few.weekendShift]) {
      assert.deepEqual([m.have, m.need, m.of], [1, 8, 'work nights']);
    }
  });
  test('enough of both: window and shift appear', () => {
    const ok = bodyClock(mk(days), '2026-10-16', TZ);
    assert.ok(ok.naturalWindow.value && ok.weekendShift.value !== null);
  });
  test('too few weekend nights names weekend nights', () => {
    const few = bodyClock(mk(weekdays), '2026-10-16', TZ);
    assert.deepEqual([few.weekendShift.have, few.weekendShift.need, few.weekendShift.of], [0, 4, 'weekend nights']);
  });
});

describe('staleNote', () => {
  test('current through yesterday: no note', () => {
    assert.equal(staleNote('2026-10-16', '2026-10-17'), null);
    assert.equal(staleNote('2026-10-17', '2026-10-17'), null);
  });
  test('older than yesterday: dated note', () => {
    assert.equal(staleNote('2026-10-14', '2026-10-17'), 'Last night synced: 14 Oct');
    assert.equal(staleNote('2026-09-30', '2026-10-17'), 'Last night synced: 30 Sep');
  });
});
