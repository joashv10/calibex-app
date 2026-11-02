import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ALPHA_FAMILYWISE, REGISTERED_TESTS, excludeDays, runH0, type CycleRow } from '../lib/stats.ts';

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

// Steps ~9000 with AR noise; recovery on D+1 moves by `beta` points per step
// above normal on D (beta > 0: fewer steps -> lower recovery).
function stepRows(n: number, beta: number, rand: () => number): CycleRow[] {
  const stepNoise = ar1(n, 0.3, 2500, rand);
  const recNoise = ar1(n, 0.3, 6, rand);
  const sleepNoise = ar1(n, 0.3, 15, rand);
  const rows: CycleRow[] = [];
  for (let i = 0; i < n; i++) {
    const day = dateAt(i);
    rows.push({
      wake_date: day,
      recovery_score: 55 + recNoise[i] + (i > 0 ? beta * stepNoise[i - 1] : 0),
      hrv_rmssd_ms: 60,
      resting_heart_rate: 55,
      day_strain: 10 + stepNoise[i] / 1500 + gaussian(rand),
      sleep_start: `${day}T23:00:00.000Z`,
      sleep_end: `${dateAt(i + 1)}T07:00:00.000Z`,
      total_sleep_minutes: Math.round(420 + sleepNoise[i]),
      deep_sleep_minutes: 90,
      step_count: Math.round(9000 + stepNoise[i]),
    });
  }
  return rows;
}

const h0d = (rows: CycleRow[]) => runH0(rows, 'UTC').find((x) => x.id === 'H0d')!;

describe('runH0 — H0d steps', () => {
  test('runs in the registered order, third after the two strain tests', () => {
    const f = runH0(stepRows(120, 0, mulberry32(1)), 'UTC');
    assert.deepEqual(f.map((x) => x.id), REGISTERED_TESTS);
    assert.deepEqual(f.slice(0, 3).map((x) => x.id), ['H0a1', 'H0a2', 'H0d']);
    const d = f[2];
    assert.equal(d.unit, 'recovery points');
    assert.equal(d.armNeeded, 10);
    assert.equal(d.essNeeded, 30);
  });

  test('family-wise alpha is 0.05 split over every registered contrast, not a literal', () => {
    const ids = runH0(stepRows(60, 0, mulberry32(2)), 'UTC').map((x) => x.id);
    assert.equal(ids.length, REGISTERED_TESTS.length);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ALPHA_FAMILYWISE, 0.05 / REGISTERED_TESTS.length);
    // 3 kept H0 tests + 3 outcomes x 2 timing contrasts + 3 outcomes x irregularity
    assert.equal(REGISTERED_TESTS.length, 12);
  });

  test('a planted +0.002 pt/step effect (fewer steps -> lower recovery) passes, CI covers truth', () => {
    const d = h0d(stepRows(400, 0.002, mulberry32(7)));
    assert.equal(d.status, 'pass');
    assert.ok(d.effect! < 0, 'fewer steps should read as lower recovery');
    const truth = -0.002 * 3000; // per 3,000 fewer steps
    assert.ok(d.lo! <= truth && truth <= d.hi!, `CI [${d.lo}, ${d.hi}] should cover ${truth}`);
    assert.ok(d.arms.high >= 10 && d.arms.low >= 10);
    assert.match(d.headline!, /3,000 fewer steps/);
  });

  test('lag is 1 day: an effect on the same morning is not found', () => {
    const rand = mulberry32(11);
    const rows = stepRows(400, 0, rand);
    // independent daily steps (no carry-over between days), so a lag-1 test can only
    // find an effect that really is lag 1; recovery on day D depends on steps on day D
    for (const r of rows) {
      r.step_count = Math.round(9000 + gaussian(rand) * 2500);
      r.recovery_score = 55 + 0.004 * (r.step_count - 9000) + gaussian(rand) * 6;
    }
    assert.notEqual(h0d(rows).status, 'pass');
  });

  test('short history is insufficient, never a claim', () => {
    const d = h0d(stepRows(25, 0.01, mulberry32(3)));
    assert.equal(d.status, 'insufficient');
    assert.equal(d.headline, null);
  });

  test("today's partial steps never enter, with or without the explicit mask", () => {
    const base = stepRows(200, 0.002, mulberry32(5));
    const partial = base.map((r, i) => (i === base.length - 1 ? { ...r, step_count: 200 } : r));
    const a = h0d(base), b = h0d(partial);
    assert.equal(b.n, a.n);
    assert.equal(b.effect, a.effect);
    const today = base[base.length - 1].wake_date;
    const masked = excludeDays(partial, [], today);
    const last = masked[masked.length - 1];
    assert.equal(last.step_count, null);
    assert.equal(last.day_strain, null);
    assert.equal(last.recovery_score, partial[partial.length - 1].recovery_score);
    assert.equal(masked[masked.length - 2].step_count, partial[partial.length - 2].step_count);
  });
});

describe('excludeDays — travel and sick', () => {
  test('skipped days lose every measure; other days (incl. rest) are untouched', () => {
    const rows = stepRows(40, 0, mulberry32(9));
    const out = excludeDays(rows, ['2025-01-10', '2025-01-11']);
    for (const d of ['2025-01-10', '2025-01-11']) {
      const r = out.find((x) => x.wake_date === d)!;
      assert.equal(r.recovery_score, null);
      assert.equal(r.step_count, null);
      assert.equal(r.day_strain, null);
      assert.equal(r.total_sleep_minutes, null);
      assert.equal(r.sleep_start, null);
    }
    assert.deepEqual(out.find((x) => x.wake_date === '2025-01-12'), rows.find((x) => x.wake_date === '2025-01-12'));
    assert.equal(out.length, rows.length);
  });

  test('the tests never use a skipped day as exposure, outcome or baseline', () => {
    const rows = stepRows(200, 0.002, mulberry32(13));
    const skip = rows.slice(50, 60).map((r) => r.wake_date);
    // wild values on the skipped days must change nothing once they are excluded
    const wild = rows.map((r) => (skip.includes(r.wake_date) ? { ...r, step_count: 100, recovery_score: 5, day_strain: 0.5 } : r));
    const clean = runH0(excludeDays(rows, skip), 'UTC');
    const dirty = runH0(excludeDays(wild, skip), 'UTC');
    for (const id of ['H0a1', 'H0d'] as const) {
      const c = clean.find((x) => x.id === id)!, d = dirty.find((x) => x.id === id)!;
      assert.equal(d.n, c.n);
      assert.equal(d.effect, c.effect);
    }
    // and without exclusion the wild days are used (so the mask is what protects the result)
    assert.notEqual(h0d(wild).effect, clean.find((x) => x.id === 'H0d')!.effect);
    assert.ok(clean.find((x) => x.id === 'H0d')!.n < h0d(rows).n);
  });
});
