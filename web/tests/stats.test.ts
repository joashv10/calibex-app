import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  nightMinutes,
  normalAt,
  vsNormal,
  lateNight,
  morningHeadline,
  runH0,
  tQuantile,
  pendingTests,
  type CycleRow,
} from '../lib/stats.ts';

// ─── seeded PRNG + helpers for synthetic data ──────────────────────────────

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
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// AR(1) noise series with ~constant variance sigma^2.
function ar1(n: number, rho: number, sigma: number, rand: () => number): number[] {
  const e: number[] = [];
  e[0] = gaussian(rand) * sigma;
  for (let i = 1; i < n; i++) {
    e[i] = rho * e[i - 1] + gaussian(rand) * sigma * Math.sqrt(1 - rho * rho);
  }
  return e;
}

function dateAt(i: number): string {
  const ms = Date.UTC(2025, 0, 1) + i * 86_400_000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

// Builds n days of rows. strainNoise/recoveryNoise are AR(1) deviations
// around fixed means; `betaPerUnit` is the true causal effect of yesterday's
// strain deviation on today's recovery, in recovery points per strain point.
// sleepNoise/bedtimeNoiseMin give the confounders (total sleep minutes,
// bedtime) some real variance — a constant confounder column is collinear
// with the intercept and makes the regression singular.
function makeRows(
  n: number,
  strainNoise: number[],
  recoveryNoise: number[],
  betaPerUnit: number,
  sleepNoise: number[],
  bedtimeNoiseMin: number[],
): CycleRow[] {
  const rows: CycleRow[] = [];
  for (let i = 0; i < n; i++) {
    const strain = 10 + strainNoise[i];
    const carry = i > 0 ? betaPerUnit * strainNoise[i - 1] : 0;
    const recovery = 50 + recoveryNoise[i] + carry;
    const day = dateAt(i);
    const bedtimeShift = Math.round(bedtimeNoiseMin[i]);
    const totalSleep = Math.round(420 + sleepNoise[i]);
    rows.push({
      wake_date: day,
      recovery_score: recovery,
      hrv_rmssd_ms: 60 + recoveryNoise[i] * 0.3,
      resting_heart_rate: 55,
      day_strain: strain,
      sleep_start: new Date(Date.parse(`${day}T23:00:00.000Z`) + bedtimeShift * 60_000).toISOString(),
      sleep_end: new Date(Date.parse(`${dateAt(i + 1)}T07:00:00.000Z`) + bedtimeShift * 60_000).toISOString(),
      total_sleep_minutes: totalSleep,
      deep_sleep_minutes: 90,
    });
  }
  return rows;
}

function makeRowsSimple(
  n: number,
  strainNoise: number[],
  recoveryNoise: number[],
  betaPerUnit: number,
  rand: () => number,
): CycleRow[] {
  const sleepNoise = ar1(n, 0.3, 15, rand);
  const bedtimeNoise = ar1(n, 0.3, 20, rand);
  return makeRows(n, strainNoise, recoveryNoise, betaPerUnit, sleepNoise, bedtimeNoise);
}

// ─── t-quantile ─────────────────────────────────────────────────────────────

describe('tQuantile', () => {
  test('matches known values', () => {
    assert.ok(Math.abs(tQuantile(0.975, 10) - 2.228) < 0.01);
    assert.ok(Math.abs(tQuantile(0.99375, 30) - 2.663) < 0.02);
  });

  test('is symmetric around 0.5', () => {
    assert.ok(Math.abs(tQuantile(0.9, 20) + tQuantile(0.1, 20)) < 1e-6);
  });
});

// ─── normalAt / nightMinutes ────────────────────────────────────────────────

describe('normalAt', () => {
  test('null if fewer than minN non-null values', () => {
    const series = [1, 2, 3, null, null, null, null, null, null, null, null, null, null, null];
    assert.equal(normalAt(series, series.length), null);
  });

  test('median of up to `window` prior values, ignoring nulls', () => {
    const vals = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
    const series: (number | null)[] = [...vals, null];
    // normalAt at index 20 (the null) looks at indices 0..19 (all 20 values present).
    assert.equal(normalAt(series, 20, 28, 14), 10.5);
  });

  test('ignores values outside the window', () => {
    const series: (number | null)[] = [1000, ...Array.from({ length: 28 }, () => 5)];
    // At index 29, window=28 looks at indices 1..28 only (all 5s) — index 0 (1000) excluded.
    assert.equal(normalAt(series, 29), 5);
  });
});

describe('nightMinutes', () => {
  test('evening time is continuous with early-morning time (Asia/Kolkata)', () => {
    // 23:30 IST and 01:30 IST the next calendar day belong to the same night.
    const evening = nightMinutes('2025-06-01T18:00:00.000Z', 'Asia/Kolkata'); // 23:30 IST
    const earlyMorning = nightMinutes('2025-06-01T20:00:00.000Z', 'Asia/Kolkata'); // 01:30 IST
    assert.equal(evening, 330);
    assert.equal(earlyMorning, 450);
    assert.ok(earlyMorning > evening);
  });

  test('18:00 is 0, midnight is 360', () => {
    assert.equal(nightMinutes('2025-06-01T12:30:00.000Z', 'Asia/Kolkata'), 0); // 18:00 IST
    assert.equal(nightMinutes('2025-06-01T18:30:00.000Z', 'Asia/Kolkata'), 360); // 00:00 IST
  });

  test('16 Oct daytime sleep (asleep 10:19) reads very late, not early', () => {
    // 10:19 IST = 04:49 UTC. The old noon anchor wrapped this to 1339-... i.e. an early-looking value;
    // on the 18:00 anchor it sits well after a 04:00 bedtime.
    const daytime = nightMinutes('2026-10-16T04:49:00.000Z', 'Asia/Calcutta');
    assert.equal(daytime, 979);
    assert.ok(daytime > nightMinutes('2026-10-16T22:30:00.000Z', 'Asia/Calcutta')); // 04:00 IST
  });
});

// ─── vsNormal / lateNight (sanity, light coverage) ─────────────────────────

describe('vsNormal / lateNight', () => {
  test('vsNormal returns null for unknown day', () => {
    const rows: CycleRow[] = [];
    assert.equal(vsNormal(rows, '2025-01-01', 'recovery_score'), null);
  });

  test('lateNight true when bedtime is >60min later than normal', () => {
    const rows: CycleRow[] = [];
    for (let i = 0; i < 20; i++) {
      rows.push({
        wake_date: dateAt(i),
        recovery_score: 50,
        hrv_rmssd_ms: 60,
        resting_heart_rate: 55,
        day_strain: 10,
        sleep_start: `${dateAt(i)}T23:00:00.000Z`, // normal bedtime
        sleep_end: `${dateAt(i + 1)}T07:00:00.000Z`,
        total_sleep_minutes: 420,
        deep_sleep_minutes: 90,
      });
    }
    // Day 20: bedtime 90 min later than the 23:00 normal.
    rows.push({
      wake_date: dateAt(20),
      recovery_score: 50,
      hrv_rmssd_ms: 60,
      resting_heart_rate: 55,
      day_strain: 10,
      sleep_start: `${dateAt(20)}T00:30:00.000Z`, // UTC as a stand-in tz for this unit test
      sleep_end: `${dateAt(21)}T07:00:00.000Z`,
      total_sleep_minutes: 420,
      deep_sleep_minutes: 90,
    });
    assert.equal(lateNight(rows, dateAt(20), 'UTC'), true);
  });
});

// ─── runH0: synthetic planted effect ────────────────────────────────────────

describe('runH0 — planted effect', () => {
  test('a ~300-day dataset with a true -2.5 pt/strain effect passes H0a1 with CI covering truth', () => {
    const n = 300;
    const rand = mulberry32(42);
    const strainNoise = ar1(n, 0.5, 3, rand);
    const recoveryNoise = ar1(n, 0.5, 8, rand);
    const betaPerUnit = -2.5;
    const rows = makeRowsSimple(n, strainNoise, recoveryNoise, betaPerUnit, rand);
    const findings = runH0(rows, 'UTC');
    const a1 = findings.find((f) => f.id === 'H0a1')!;
    assert.equal(a1.status, 'pass');
    assert.ok(a1.effect !== null && a1.effect < 0);
    const trueEffect = betaPerUnit * 2; // reported per the 2-strain step
    assert.ok(a1.lo !== null && a1.hi !== null);
    assert.ok(a1.lo! <= trueEffect && trueEffect <= a1.hi!, `CI [${a1.lo}, ${a1.hi}] should cover ${trueEffect}`);
    assert.ok(a1.headline && a1.headline.length > 0);
  });
});

// ─── runH0: null dataset, false-positive rate ──────────────────────────────

describe('runH0 — null dataset false-positive rate', () => {
  test('H0a1 pass rate is <=5% across 200 seeded simulations with no true effect', () => {
    const n = 250;
    let passes = 0;
    const sims = 200;
    for (let seed = 1; seed <= sims; seed++) {
      const rand = mulberry32(seed * 7919);
      const strainNoise = ar1(n, 0.6, 3, rand);
      const recoveryNoise = ar1(n, 0.6, 8, rand);
      const rows = makeRowsSimple(n, strainNoise, recoveryNoise, 0, rand);
      const a1 = runH0(rows, 'UTC').find((f) => f.id === 'H0a1')!;
      if (a1.status === 'pass') passes++;
    }
    const rate = passes / sims;
    assert.ok(rate <= 0.05, `false-positive rate ${rate} exceeds 5% (${passes}/${sims})`);
  });
});

// ─── ESS shrinkage under autocorrelation ───────────────────────────────────

describe('runH0 — ESS shrinks under autocorrelation', () => {
  test('strong AR(1) residuals give ESS well below the weak-autocorrelation case', () => {
    const n = 150;
    const randWeak = mulberry32(1);
    const weakRows = makeRowsSimple(n, ar1(n, 0.0, 3, randWeak), ar1(n, 0.0, 8, randWeak), 0, randWeak);
    const weak = runH0(weakRows, 'UTC').find((f) => f.id === 'H0a1')!;

    const randStrong = mulberry32(1);
    const strongRows = makeRowsSimple(n, ar1(n, 0.9, 3, randStrong), ar1(n, 0.9, 8, randStrong), 0, randStrong);
    const strong = runH0(strongRows, 'UTC').find((f) => f.id === 'H0a1')!;

    assert.ok(strong.ess < weak.ess, `expected strong-AR ess (${strong.ess}) < weak-AR ess (${weak.ess})`);
    assert.ok(strong.ess < strong.n * 0.5, `expected strong ess (${strong.ess}) well below n (${strong.n})`);
  });
});

// ─── short data ─────────────────────────────────────────────────────────────

describe('runH0 — short data', () => {
  test('40 days of data is insufficient, with the right progress text', () => {
    const n = 40;
    const rand = mulberry32(3);
    const rows = makeRowsSimple(n, ar1(n, 0.3, 3, rand), ar1(n, 0.3, 8, rand), 0, rand);
    const findings = runH0(rows, 'UTC');
    for (const f of findings) {
      assert.equal(f.status, 'insufficient');
      assert.ok(/of 30 effective days/.test(f.progress) || /^need \d+/.test(f.progress));
    }
  });
});

// ─── morningHeadline ────────────────────────────────────────────────────────

describe('morningHeadline', () => {
  test('null below 14 days of history', () => {
    const rows: CycleRow[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push({
        wake_date: dateAt(i),
        recovery_score: 50,
        hrv_rmssd_ms: 60,
        resting_heart_rate: 55,
        day_strain: 10,
        sleep_start: null,
        sleep_end: null,
        total_sleep_minutes: null,
        deep_sleep_minutes: 90 + i, // climbing every day: would be a run if long enough
      });
    }
    assert.equal(morningHeadline(rows, dateAt(9)), null);
  });

  test('picks the metric with the longest personal-best run', () => {
    const n = 30;
    const rows: CycleRow[] = [];
    for (let i = 0; i < n; i++) {
      rows.push({
        wake_date: dateAt(i),
        // recovery_score: best only in the last 15 days (beaten at i=14 by equal value).
        recovery_score: i === n - 1 ? 80 : i === n - 1 - 15 ? 80 : 50,
        // deep_sleep_minutes: best in the entire 30-day history (strict personal best, no tie).
        hrv_rmssd_ms: 60,
        resting_heart_rate: 55,
        day_strain: 10,
        sleep_start: null,
        sleep_end: null,
        total_sleep_minutes: null,
        deep_sleep_minutes: i === n - 1 ? 120 : 90,
      });
    }
    const headline = morningHeadline(rows, dateAt(n - 1));
    assert.ok(headline && headline.startsWith('Deepest sleep'), `got: ${headline}`);
  });

  test('formats run length in days/weeks/months and "since data starts"', () => {
    // 29 days of history (index 0..28), day 29 is a strict personal best
    // over all of it -> beats all history, but history < 60 days, so it
    // should use the weeks/days formatting, not "since your WHOOP data starts".
    const n = 30;
    const rows: CycleRow[] = [];
    for (let i = 0; i < n; i++) {
      rows.push({
        wake_date: dateAt(i),
        recovery_score: 50,
        hrv_rmssd_ms: 60,
        resting_heart_rate: 55,
        day_strain: 10,
        sleep_start: null,
        sleep_end: null,
        total_sleep_minutes: null,
        deep_sleep_minutes: i === n - 1 ? 120 : 90,
      });
    }
    const headline = morningHeadline(rows, dateAt(n - 1));
    assert.ok(headline && /in \d+ (days|weeks)/.test(headline), `got: ${headline}`);
  });

  test('"since your WHOOP data starts" when the best beats >=60 days of history', () => {
    const n = 70;
    const rows: CycleRow[] = [];
    for (let i = 0; i < n; i++) {
      rows.push({
        wake_date: dateAt(i),
        recovery_score: 50,
        hrv_rmssd_ms: 60,
        resting_heart_rate: 55,
        day_strain: 10,
        sleep_start: null,
        sleep_end: null,
        total_sleep_minutes: null,
        deep_sleep_minutes: i === n - 1 ? 120 : 90,
      });
    }
    const headline = morningHeadline(rows, dateAt(n - 1));
    assert.equal(headline, 'Deepest sleep since your WHOOP data starts.');
  });
});

describe('pendingTests', () => {
  const cyc = (d: string, rec: number | null, hrv: number | null): CycleRow => ({
    wake_date: d, recovery_score: rec, hrv_rmssd_ms: hrv, resting_heart_rate: null, day_strain: null,
    sleep_start: null, sleep_end: null, total_sleep_minutes: null, deep_sleep_minutes: null,
  });
  const cycles = [cyc('2026-10-02', 60, 50), cyc('2026-10-03', 70, 55), cyc('2026-10-04', null, null), cyc('2026-10-05', 40, 30)];

  test('arms count only days whose next morning was scored', () => {
    const [dinner, drinks] = pendingTests({
      cycles,
      // usual 180 (21:00 on the evening clock): 01 late, 02 early, 03 late but 04 unscored, 04 late
      dinners: [{ day: '2026-10-01', min: 240 }, { day: '2026-10-02', min: 120 }, { day: '2026-10-03', min: 240 }, { day: '2026-10-04', min: 230 }],
      settingsDinnerMin: 180,
      drinkDays: new Set(['2026-10-01', '2026-10-03']),
      foodDays: new Set(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']),
    });
    assert.deepEqual(dinner.arms.map((a) => a.have), [2, 1]);
    assert.deepEqual(drinks.arms.map((a) => a.have), [1, 2]);
    assert.equal(dinner.need, 10);
  });

  test('no usual dinner time → no dinner arms; no logs → zeros', () => {
    const [dinner, drinks] = pendingTests({ cycles, dinners: [{ day: '2026-10-01', min: 300 }], settingsDinnerMin: null, drinkDays: new Set(), foodDays: new Set() });
    assert.deepEqual(dinner.arms.map((a) => a.have), [0, 0]);
    assert.deepEqual(drinks.arms.map((a) => a.have), [0, 0]);
  });
});
