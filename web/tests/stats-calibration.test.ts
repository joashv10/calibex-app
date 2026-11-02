// Null calibration of the engine: with no real effect, how often does a
// registered test pass, and does the reported standard error match the real
// spread of the slope? Synthetic series only; seeds are fixed. The default run
// keeps this file under a minute and asserts on the t-statistic's RMS pooled
// over the whole family (1.0 when the SE is right; it read 1.1-1.3 on the
// HAC-only engine); STRESS_SCALE=3 (>= 240 seeds) also asserts per test and on
// the pass rates, which are not readable at 80 seeds when the nominal rate is
// 0.4%. The family is REGISTERED_TESTS: H0a1, H0a2, H0d, H2a (two contrasts x
// three outcomes) and H2b (three outcomes), so H2a's band dummies and H2b's
// rolling-irregularity exposure are calibrated here too.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ALPHA_FAMILYWISE, REGISTERED_TESTS, runH0, tQuantile, type CycleRow, type DrinkMap, type Finding } from '../lib/stats.ts';

const SCALE = Number(process.env.STRESS_SCALE ?? 1);
const HEAVY = SCALE >= 3;

// sfc32, one stream per series, not the mulberry32 the other test files use:
// consecutive mulberry32 segments are not independent enough for this. Drawing
// the sleep-shift series and then the outcome series from one mulberry32 stream
// gave a rolling-SD exposure a slope spread 1.18x its exact OLS standard error
// on a WHITE outcome, where OLS is exact; independent sfc32 streams give 1.00.
function sfc32(seed: number) {
  let a = seed | 0;
  let b = 0x9e3779b9;
  let c = 0x243f6a88;
  let d = 0xb7e15162;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}
// The i-th independent stream of a seed (series i of one simulated history).
const stream = (seed: number, i: number) => sfc32(seed * 1_000_003 + i * 7919 + 17);
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
const log = (...a: unknown[]) => console.log('[calibration]', ...a);
const pct = (k: number, n: number) => `${((100 * k) / n).toFixed(1)}%`;

// Outcomes share a "how I feel" component and carry their own AR(1) noise (rho);
// exposures (sleep timing, sleep, strain, steps) are AR(1) with rhoX. The engine
// then turns both into rolling-baseline deviations, so x is autocorrelated too.
// Drinking is an independent coin per night (known on every night). beta plants
// a next-day strain -> recovery effect (points per strain point).
function sim(n: number, rho: number, rhoX: number, seed: number, beta = 0): { rows: CycleRow[]; drinks: DrinkMap } {
  const shift = ar1(n, rhoX, 55, stream(seed, 0));
  const common = ar1(n, rho, 1, stream(seed, 1));
  const rec = ar1(n, rho, 7, stream(seed, 2));
  const hrv = ar1(n, rho, 8, stream(seed, 3));
  const rhr = ar1(n, rho, 2, stream(seed, 4));
  const sleep = ar1(n, rhoX, 20, stream(seed, 5));
  const strain = ar1(n, rhoX, 3, stream(seed, 6));
  const steps = ar1(n, rhoX, 2000, stream(seed, 7));
  const coin = stream(seed, 8);
  const rows: CycleRow[] = [];
  const drinks: DrinkMap = new Map();
  for (let i = 0; i < n; i++) {
    const day = dateAt(i);
    drinks.set(day, coin() < 0.25 ? 'wet' : 'dry');
    const mid = Date.parse(`${day}T03:00:00.000Z`) + Math.round(shift[i]) * 60_000;
    rows.push({
      wake_date: day,
      recovery_score: 55 + 4 * common[i] + rec[i] + (i > 0 ? beta * strain[i - 1] : 0),
      hrv_rmssd_ms: 60 + 4 * common[i] + hrv[i],
      resting_heart_rate: 55 - common[i] + rhr[i],
      day_strain: 10 + strain[i],
      sleep_start: new Date(mid - 4 * 3_600_000).toISOString(),
      sleep_end: new Date(mid + 4 * 3_600_000).toISOString(),
      total_sleep_minutes: Math.round(420 + sleep[i]),
      deep_sleep_minutes: 90,
      step_count: Math.round(9000 + steps[i]),
    });
  }
  return { rows, drinks };
}

// Regressors per test (intercept + exposure column(s) + confounders) and the
// reporting step, to read the slope and its SE back out of a Finding.
const IDS: Finding['id'][] = [...REGISTERED_TESTS];
const K = (id: Finding['id']): number =>
  id === 'H0a1' ? 3 : id === 'H0a2' || id === 'H0d' ? 4 : id.startsWith('H2a') ? 6 : 5;
const STEP = (id: Finding['id']): number =>
  id === 'H0d' ? 3000 : id.startsWith('H0a') ? 2 : id.startsWith('H2b') ? 30 : 1;
const sd = (a: number[]) => {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

function assertFinite(fs: Finding[], what: string) {
  assert.equal(fs.length, REGISTERED_TESTS.length, `${what}: family size`);
  for (const f of fs) {
    for (const [k, v] of Object.entries({ n: f.n, ess: f.ess, effect: f.effect, lo: f.lo, hi: f.hi })) {
      assert.ok(v === null || Number.isFinite(v), `${what}: ${f.id} (${f.status}).${k} = ${v}`);
    }
    assert.ok(!/NaN|Infinity|undefined/.test(`${f.progress} ${f.headline ?? ''}`), `${what}: ${f.id} text "${f.progress}" "${f.headline}"`);
  }
}

// Runs `seeds` null histories of n0..n0+nRange days and returns, per test, the
// pass count, the ratio of the slope's real spread to its mean reported SE, and
// the RMS of effect/SE (both ~1 when the SE is honest), plus the family rate.
function nullRun(rho: number, rhoX: number, seeds: number, n0: number, nRange: number) {
  const passes: Record<string, number> = {};
  const bs: Record<string, number[]> = {};
  const ses: Record<string, number[]> = {};
  for (const id of IDS) { passes[id] = 0; bs[id] = []; ses[id] = []; }
  let family = 0;
  const cell = Math.round(rho * 1000) * 10 + Math.round(rhoX * 10);
  for (let seed = 1; seed <= seeds; seed++) {
    const s = seed * 97 + cell;
    const n = n0 + Math.floor(nRange * stream(s, 9)());
    const { rows, drinks } = sim(n, rho, rhoX, s);
    const fs = runH0(rows, 'UTC', drinks);
    assertFinite(fs, `rho ${rho} seed ${seed}`);
    let any = false;
    for (const f of fs) {
      if (f.status === 'pass') { passes[f.id]++; any = true; }
      if (f.effect !== null && f.hi !== null) {
        const tcrit = tQuantile(1 - ALPHA_FAMILYWISE / 2, Math.max(1, f.ess - K(f.id)));
        bs[f.id].push(f.effect / STEP(f.id));
        ses[f.id].push((f.hi - f.effect) / tcrit / STEP(f.id));
      }
    }
    if (any) family++;
  }
  const ratio: Record<string, number> = {};
  const rmsT: Record<string, number> = {};
  const allT: number[] = [];
  for (const id of IDS) {
    ratio[id] = sd(bs[id]) / mean(ses[id]);
    const ts = bs[id].map((b, i) => b / ses[id][i]);
    rmsT[id] = Math.sqrt(mean(ts.map((t) => t * t)));
    allT.push(...ts);
  }
  const pooledRmsT = Math.sqrt(mean(allT.map((t) => t * t)));
  return { passes, family, ratio, rmsT, pooledRmsT };
}

// Pooled RMS t within 20% of 1 (the HAC-only engine sat at 1.1-1.3 wherever
// autocorrelation was present). Per test: within 40% in light mode (80 seeds is
// noisy per test), within 25% in heavy mode.
function assertCalibrated(r: ReturnType<typeof nullRun>, what: string) {
  assert.ok(r.pooledRmsT <= 1.2, `${what}: pooled RMS t is ${r.pooledRmsT.toFixed(2)} (CIs too narrow)`);
  for (const id of IDS) {
    const bound = HEAVY ? 1.25 : 1.4;
    assert.ok(r.rmsT[id] <= bound, `${what}: ${id} RMS t is ${r.rmsT[id].toFixed(2)} (CI too narrow)`);
  }
}

const line = (r: ReturnType<typeof nullRun>, seeds: number) =>
  `family ${r.family}/${seeds}=${pct(r.family, seeds)}; pooled rms t ${r.pooledRmsT.toFixed(2)}; ` +
  IDS.map((id) => `${id} ${r.passes[id]} t=${r.rmsT[id].toFixed(2)}`).join(' ');

describe('null calibration: no real effect, AR(1) outcomes and exposures through the rolling baseline', () => {
  // Real WHOOP data sits near lag-1 0.1-0.2; 0.5 and 0.7 are the stress cases.
  const cells: [number, number][] = HEAVY
    ? [[0, 0.3], [0.3, 0.3], [0.5, 0.3], [0.7, 0.3], [0, 0.6], [0.3, 0.6], [0.5, 0.6], [0.7, 0.6]]
    : [[0, 0.3], [0.5, 0.6]];
  for (const [rho, rhoX] of cells) {
    test(`rho ${rho}, rhoX ${rhoX}: reported SE matches the real slope spread; pass rates near nominal`, () => {
      const seeds = 80 * SCALE;
      const r = nullRun(rho, rhoX, seeds, 300, 150);
      log(`rho=${rho} rhoX=${rhoX} (${seeds} seeds): ${line(r, seeds)}`);
      assertCalibrated(r, `rho ${rho} rhoX ${rhoX}`);
      if (HEAVY) {
        // Family-wise 5% target; 8% is 2 SD of binomial noise above it at 240 seeds.
        assert.ok(r.family / seeds <= 0.08, `family-wise false-positive rate ${pct(r.family, seeds)} (${r.family}/${seeds})`);
        // Each test's nominal rate is 0.4%; 2% leaves room for binomial noise at 240 seeds.
        for (const id of IDS) assert.ok(r.passes[id] / seeds <= 0.02, `${id} passed ${r.passes[id]}/${seeds} under the null (nominal ${(100 * ALPHA_FAMILYWISE).toFixed(2)}%)`);
      }
    });
  }

  test('small n (80-120 days, just past the gate): the same holds where HAC small-sample bias is worst', () => {
    const seeds = 80 * SCALE;
    const r = nullRun(0.3, 0.6, seeds, 80, 40);
    log(`small n rho=0.3 rhoX=0.6 (${seeds} seeds): ${line(r, seeds)}`);
    assertCalibrated(r, 'small n');
    if (HEAVY) assert.ok(r.family / seeds <= 0.08, `family-wise false-positive rate ${pct(r.family, seeds)}`);
  });
});

describe('power: a planted effect is still found', () => {
  test('-1 recovery point per strain point above normal, n 300, rho 0.5: H0a1 passes in >= 75% of seeds, CI covers truth', () => {
    const seeds = 12 * SCALE;
    let hits = 0;
    let covers = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const { rows, drinks } = sim(300, 0.5, 0.5, seed * 2713, -1);
      const a1 = runH0(rows, 'UTC', drinks).find((f) => f.id === 'H0a1')!;
      if (a1.status === 'pass') {
        hits++;
        assert.ok(a1.effect! < 0, `seed ${seed}: effect ${a1.effect} has the wrong sign`);
      }
      if (a1.lo !== null && a1.lo <= -2 && a1.hi! >= -2) covers++;
    }
    log(`power (${seeds} seeds): H0a1 found ${hits}/${seeds}; CI covered the true -2 per step in ${covers}`);
    assert.ok(hits / seeds >= 0.75, `H0a1 found the planted effect in only ${hits}/${seeds}`);
    assert.ok(covers / seeds >= 0.9, `CI covered the truth in only ${covers}/${seeds}`);
  });
});

describe('degenerate design never passes', () => {
  // A confounder that never varies is collinear with the intercept: X'X is
  // singular and every estimate is NaN. NaN fails every comparison, so an
  // unguarded engine skips the "CI covers 0" branch and lands on 'pass'.
  const cases: [string, Partial<CycleRow>][] = [
    ['constant total sleep', { total_sleep_minutes: 420 }],
    ['constant strain', { day_strain: 10 }],
  ];
  for (const [name, patch] of cases) {
    test(`${name}: every broken fit is 'insufficient' with no NaN in any field`, () => {
      const { rows, drinks } = sim(350, 0.3, 0.3, 61);
      const fs = runH0(rows.map((r) => ({ ...r, ...patch })), 'UTC', drinks);
      assertFinite(fs, name);
      for (const f of fs) assert.notEqual(f.status, 'pass', `${name}: ${f.id} passed: ${f.headline}`);
      // Every fit the constant column breaks says so in plain words, unless a
      // count gate is short too, which is the better explanation and keeps its line.
      const broken = fs.filter((f) => f.effect === null);
      assert.ok(broken.length > 0, `${name}: expected at least one singular fit`);
      for (const f of broken) {
        assert.equal(f.status, 'insufficient', `${name}: ${f.id}`);
        assert.equal(f.headline, null);
        assert.deepEqual([f.lo, f.hi], [null, null]);
        assert.ok(f.progress === 'Not enough variation to tell yet' || /^need \d+ .+, have \d+$/.test(f.progress), `${name}: ${f.id} "${f.progress}"`);
      }
      assert.ok(broken.some((f) => f.progress === 'Not enough variation to tell yet'), `${name}: no fit named the missing variation`);
    });
  }

  test('constant recovery (zero-variance outcome): slope and SE are 0, so unclear, never a pass', () => {
    const { rows, drinks } = sim(350, 0.3, 0.3, 62);
    const fs = runH0(rows.map((r) => ({ ...r, recovery_score: 61 })), 'UTC', drinks);
    assertFinite(fs, 'constant recovery');
    for (const f of fs) assert.notEqual(f.status, 'pass', `${f.id} passed: ${f.headline}`);
  });
});
