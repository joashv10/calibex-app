import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALPHA_FAMILYWISE,
  REGISTERED_TESTS,
  drinkStatus,
  progressSentence,
  runH0,
  timingBand,
  weekIrregularityAt,
  type CycleRow,
  type DrinkMap,
  type Finding,
} from '../lib/stats.ts';

function mulberry32(seed: number) {
  let s = seed | 0;
  return function rand() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rand());
}
function ar1(n: number, rho: number, sigma: number, rand: () => number): number[] {
  const e: number[] = [gaussian(rand) * sigma];
  for (let i = 1; i < n; i++) e[i] = rho * e[i - 1] + gaussian(rand) * sigma * Math.sqrt(1 - rho * rho);
  return e;
}
function dateAt(i: number): string {
  const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// n nights, sleep midpoint shifting by an AR(1) number of minutes around 03:00 UTC.
// Planted effects on the night's outcomes: `later` applies to nights whose shift is
// >= +60 min (recovery points, bpm), `wetEffect` to drinking nights (recovery).
// Drinking is drawn at random (`wetRate`) and known for every night.
function nights(
  n: number,
  rand: () => number,
  opts: { later?: { recovery: number; rhr: number }; wetRate?: number; wetEffect?: number } = {},
): { rows: CycleRow[]; drinks: DrinkMap } {
  const shift = ar1(n, 0.3, 55, rand);
  const recNoise = ar1(n, 0.3, 7, rand);
  const rhrNoise = ar1(n, 0.3, 2, rand);
  const sleepNoise = ar1(n, 0.3, 20, rand);
  const strainNoise = ar1(n, 0.3, 3, rand);
  const rows: CycleRow[] = [];
  const drinks: DrinkMap = new Map();
  for (let i = 0; i < n; i++) {
    const day = dateAt(i);
    const wet = rand() < (opts.wetRate ?? 0.25);
    drinks.set(day, wet ? 'wet' : 'dry');
    const late = shift[i] >= 60;
    const mid = Date.parse(`${day}T03:00:00.000Z`) + Math.round(shift[i]) * 60_000;
    rows.push({
      wake_date: day,
      recovery_score: 55 + recNoise[i] + (late ? opts.later?.recovery ?? 0 : 0) + (wet ? opts.wetEffect ?? 0 : 0),
      hrv_rmssd_ms: 60 + recNoise[i] * 0.5,
      resting_heart_rate: 55 + rhrNoise[i] + (late ? opts.later?.rhr ?? 0 : 0),
      day_strain: 10 + strainNoise[i],
      sleep_start: new Date(mid - 4 * 3_600_000).toISOString(),
      sleep_end: new Date(mid + 4 * 3_600_000).toISOString(),
      total_sleep_minutes: Math.round(420 + sleepNoise[i]),
      deep_sleep_minutes: 90,
    });
  }
  return { rows, drinks };
}

const byId = (fs: Finding[], id: Finding['id']) => fs.find((f) => f.id === id)!;

describe('H2a bands', () => {
  test('an hour either side of usual is the boundary, inclusive', () => {
    assert.equal(timingBand(-60), 'earlier');
    assert.equal(timingBand(-61), 'earlier');
    assert.equal(timingBand(-59), 'near');
    assert.equal(timingBand(0), 'near');
    assert.equal(timingBand(59), 'near');
    assert.equal(timingBand(60), 'later');
    assert.equal(timingBand(200), 'later');
  });

  test('band counts are reported and the near-usual band is the comparison arm', () => {
    const { rows, drinks } = nights(300, mulberry32(5));
    const f = byId(runH0(rows, 'UTC', drinks), 'H2a-later-recovery');
    assert.ok(f.bands);
    assert.equal(f.bands!.earlier + f.bands!.near + f.bands!.later, f.n);
    assert.deepEqual(f.arms, { high: f.bands!.later, low: f.bands!.near });
  });
});

describe('drinking status', () => {
  test('journal answers belong to their own wake_date; AL1 and Food logs to the next one', () => {
    const m = drinkStatus({
      journal: [
        { wake_date: '2026-01-10', answered_yes: true },
        { wake_date: '2026-01-11', answered_yes: false },
        { wake_date: '2026-01-12', answered_yes: null },
      ],
      al1: [
        { wake_date: '2026-01-20', raw_value: '1–2', status: 'answered' }, // dinner on the 20th -> night ending the 21st
        { wake_date: '2026-01-21', raw_value: 'None', status: 'answered' },
        { wake_date: '2026-01-22', raw_value: null, status: 'skipped' },
      ],
      substances: [
        { wake_date: '2026-02-01', substance: 'alcohol' },
        { wake_date: '2026-02-02', substance: 'caffeine' },
      ],
    });
    // journal: same day
    assert.equal(m.get('2026-01-10'), 'wet');
    assert.equal(m.get('2026-01-11'), 'dry');
    assert.equal(m.get('2026-01-12'), undefined, 'an unanswered journal row is unknown');
    assert.equal(m.get('2026-01-09'), undefined, 'the journal never shifts a day');
    // AL1: the next morning, never the logging day
    assert.equal(m.get('2026-01-20'), undefined);
    assert.equal(m.get('2026-01-21'), 'wet');
    assert.equal(m.get('2026-01-22'), 'dry');
    assert.equal(m.get('2026-01-23'), undefined, 'a skipped AL1 is unknown');
    // Food tab alcohol: the next morning; caffeine says nothing
    assert.equal(m.get('2026-02-01'), undefined);
    assert.equal(m.get('2026-02-02'), 'wet');
    assert.equal(m.get('2026-02-03'), undefined);
  });

  test('wet beats dry when sources disagree, whichever comes first', () => {
    const a = drinkStatus({
      journal: [{ wake_date: '2026-03-02', answered_yes: false }],
      al1: [{ wake_date: '2026-03-01', raw_value: '3–4', status: 'answered' }],
      substances: [],
    });
    assert.equal(a.get('2026-03-02'), 'wet');
    const b = drinkStatus({
      journal: [{ wake_date: '2026-03-02', answered_yes: true }],
      al1: [{ wake_date: '2026-03-01', raw_value: 'None', status: 'answered' }],
      substances: [],
    });
    assert.equal(b.get('2026-03-02'), 'wet');
  });

  test('nights with unknown status are left out of the sleep tests', () => {
    const { rows, drinks } = nights(300, mulberry32(8));
    const all = byId(runH0(rows, 'UTC', drinks), 'H2b-recovery');
    const half: DrinkMap = new Map([...drinks].filter(([d]) => d < dateAt(200)));
    const part = byId(runH0(rows, 'UTC', half), 'H2b-recovery');
    assert.ok(part.n < all.n);
    assert.ok(part.n <= 200);
    assert.equal(part.drink!.wet + part.drink!.dry, part.n);
  });
});

describe('wet / dry gate', () => {
  test('no drinking data: the sleep tests say which side is missing, the H0 tests run as before', () => {
    const { rows } = nights(300, mulberry32(3));
    const fs = runH0(rows, 'UTC');
    for (const f of fs.filter((x) => x.id.startsWith('H2'))) {
      assert.equal(f.status, 'insufficient');
      assert.equal(f.progress, 'need 5 drinking nights to take drinking out, have 0');
      assert.deepEqual(f.drink, { wet: 0, dry: 0 });
    }
    assert.notEqual(byId(fs, 'H0a1').status, 'insufficient');
  });

  test('3 drinking days among 300 known: "need 5 drinking nights to take drinking out, have 3"', () => {
    const { rows, drinks } = nights(300, mulberry32(4), { wetRate: 0 });
    for (const d of [dateAt(100), dateAt(150), dateAt(200)]) drinks.set(d, 'wet');
    const f = byId(runH0(rows, 'UTC', drinks), 'H2a-later-hrv');
    assert.equal(f.status, 'insufficient');
    assert.equal(f.progress, 'need 5 drinking nights to take drinking out, have 3');
  });

  test('all drinking days: the dry side is the one named', () => {
    const { rows, drinks } = nights(300, mulberry32(4), { wetRate: 1 });
    const f = byId(runH0(rows, 'UTC', drinks), 'H2b-rhr');
    assert.equal(f.status, 'insufficient');
    assert.equal(f.progress, 'need 5 dry nights to take drinking out, have 0');
  });

  test('the drinking column is a real confounder: a planted drinking effect does not leak into the timing contrast', () => {
    // Drinking nights: recovery -25. No timing effect. With drinking held fixed the
    // later-vs-near contrast must stay unclear and its estimate near zero.
    const { rows, drinks } = nights(400, mulberry32(11), { wetEffect: -25 });
    const f = byId(runH0(rows, 'UTC', drinks), 'H2a-later-recovery');
    assert.notEqual(f.status, 'insufficient', f.progress);
    assert.ok(Math.abs(f.effect!) < 5, `effect ${f.effect} should sit near 0`);
    assert.equal(f.status, 'unclear');
  });
});

describe('H2a planted effects and signs', () => {
  const { rows, drinks } = nights(500, mulberry32(21), { later: { recovery: -10, rhr: 4 } });
  const fs = runH0(rows, 'UTC', drinks);

  test('later nights: recovery reads lower and is marked as the harmful direction', () => {
    const f = byId(fs, 'H2a-later-recovery');
    assert.equal(f.status, 'pass', f.progress);
    assert.ok(f.effect! < 0);
    assert.ok(f.lo! <= -10 && -10 <= f.hi!, `CI [${f.lo}, ${f.hi}] should cover -10`);
    assert.equal(f.worse, true);
    assert.match(f.headline!, /later than usual: recovery about \d+ points lower/);
  });

  test('later nights: resting heart rate reads HIGHER, in bpm, and higher is the harmful direction', () => {
    const f = byId(fs, 'H2a-later-rhr');
    assert.equal(f.status, 'pass', f.progress);
    assert.equal(f.unit, 'bpm');
    assert.ok(f.effect! > 0, 'a planted +4 bpm must come out positive');
    // The planted band is the raw shift; the test's band is the shift against a rolling
    // usual, and the outcome is its own deviation from a normal that late nights also
    // move. Both pull the estimate towards zero, never past the truth.
    assert.ok(f.effect! <= 4.5 && f.hi! >= 2, `effect ${f.effect} [${f.lo}, ${f.hi}] should sit between 0 and +4`);
    assert.equal(f.worse, true);
    assert.match(f.headline!, /resting heart rate about \d+ bpm higher/);
  });

  test('a lower resting heart rate is not harm', () => {
    const { rows: r2, drinks: d2 } = nights(500, mulberry32(22), { later: { recovery: 0, rhr: -4 } });
    const f = byId(runH0(r2, 'UTC', d2), 'H2a-later-rhr');
    assert.equal(f.status, 'pass', f.progress);
    assert.ok(f.effect! < 0);
    assert.equal(f.worse, false);
    assert.match(f.headline!, /bpm lower/);
  });

  test('the earlier contrast stays unclear when only later nights were changed', () => {
    const f = byId(fs, 'H2a-earlier-recovery');
    assert.notEqual(f.status, 'insufficient', f.progress);
    assert.equal(f.status, 'unclear');
  });

  test('every contrast uses the family-wise alpha over 12 registered tests', () => {
    assert.equal(REGISTERED_TESTS.length, 12);
    assert.equal(ALPHA_FAMILYWISE, 0.05 / 12);
    assert.equal(fs.filter((f) => f.id.startsWith('H2a-')).length, 6);
    assert.equal(fs.filter((f) => f.id.startsWith('H2b-')).length, 3);
    assert.ok(!fs.some((f) => (f.id as string) === 'H0b' || (f.id as string) === 'H0c'), 'H0b and H0c are retired');
  });
});

describe('H2b irregularity measure', () => {
  test('weekIrregularityAt is the median |midpoint − usual| over 7 nights, null under 5', () => {
    // 28 steady nights at 540, then a week that alternates ±30 and ±90
    const mids: (number | null)[] = Array.from({ length: 28 }, () => 540);
    mids.push(570, 450, 630, 510, null, 540, 600); // |dev|: 30, 90, 90, 30, -, 0, 60
    const r = weekIrregularityAt(mids, mids.length - 1);
    assert.equal(r.have, 6);
    assert.equal(r.value, 45); // median of 0,30,30,60,90,90
    // a usual needs 14 earlier nights, so at index 16 only nights 14..16 have one
    const early = weekIrregularityAt(mids, 16);
    assert.equal(early.have, 3);
    assert.equal(early.value, null);
  });

  test('null midpoint deviations propagate as missing nights, never as zero', () => {
    const mids: (number | null)[] = Array.from({ length: 35 }, () => 540);
    for (let i = 29; i < 35; i++) mids[i] = null;
    const r = weekIrregularityAt(mids, 34);
    assert.equal(r.have, 1);
    assert.equal(r.value, null);
  });
});

describe('progressSentence reads after "Not clear yet."', () => {
  test('gate, effective-days and fallback lines', () => {
    assert.equal(progressSentence('need 5 drinking nights to take drinking out, have 0'), 'Needs 5 drinking nights to take drinking out; has 0.');
    assert.equal(progressSentence('need 15 earlier nights, have 3'), 'Needs 15 earlier nights; has 3.');
    assert.equal(progressSentence('12 of 30 effective days'), 'Has 12 of the 30 days of data it needs.');
    assert.equal(progressSentence('Enough days, no clear effect yet'), 'Enough days, no clear effect yet.');
    assert.equal(progressSentence('Not enough variation to tell yet'), 'Not enough variation to tell yet.');
  });
});
