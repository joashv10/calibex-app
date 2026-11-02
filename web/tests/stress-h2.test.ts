// STRESS TEST for the H0/H2 engine (runH0). Synthetic series only; no I/O.
// Seeds are fixed, so every number is reproducible. STRESS_SCALE=n multiplies the
// seed counts; the default keeps this whole file around 15 s, and the pass-rate
// bounds under the null are only asserted at STRESS_SCALE>=3 (they are not readable
// at 24 seeds when the nominal rate is 0.4% a test). stats-calibration.test.ts is
// the fuller null calibration (8 autocorrelation cells, SE against slope spread).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALPHA_FAMILYWISE,
  REGISTERED_TESTS,
  progressSentence,
  runH0,
  type CycleRow,
  type DrinkMap,
  type Finding,
} from '../lib/stats.ts';

const SCALE = Number(process.env.STRESS_SCALE ?? 1);
const HEAVY = SCALE >= 3;

// sfc32 with one independent stream per simulated series (stats-calibration has
// the same generator). Drawing the sleep shift and then the outcomes from ONE
// mulberry32 stream, as this file first did, put a dependence between them that
// alone inflated the null pass rate; a stream per series removes it.
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
// The i-th independent stream of a seed.
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
const byId = (fs: Finding[], id: Finding['id']) => fs.find((f) => f.id === id)!;
const pct = (k: number, n: number) => `${((100 * k) / n).toFixed(1)}%`;
const log = (...a: unknown[]) => console.log('[stress]', ...a);

type Effect = { recovery: number; hrv: number; rhr: number };
type SimOpts = {
  n: number;
  rho?: number;          // AR(1) on recovery / HRV / RHR noise
  later?: Effect;        // planted effect on nights whose sleep shift is >= +60 min
  wetBase?: number;      // P(wet) on a night that is not late
  wetIfLate?: number;    // P(wet) on a late night (the confounding)
  wetEffect?: Effect;    // what drinking alone does
};

// Sleep midpoint = 03:00 UTC + AR(1) shift (sd 55 min). Outcomes share a "how I feel"
// component so they co-move, plus their own AR(1) noise.
function sim(opts: SimOpts, seed: number): { rows: CycleRow[]; drinks: DrinkMap } {
  const { n } = opts;
  const rho = opts.rho ?? 0.45;
  const shift = ar1(n, 0.3, 55, stream(seed, 0));
  const common = ar1(n, rho, 1, stream(seed, 1));
  const rec = ar1(n, rho, 7, stream(seed, 2));
  const hrv = ar1(n, rho, 8, stream(seed, 3));
  const rhr = ar1(n, rho, 2, stream(seed, 4));
  const sleep = ar1(n, 0.3, 20, stream(seed, 5));
  const strain = ar1(n, 0.3, 3, stream(seed, 6));
  const steps = ar1(n, 0.3, 2000, stream(seed, 7));
  const coin = stream(seed, 8);
  const rows: CycleRow[] = [];
  const drinks: DrinkMap = new Map();
  for (let i = 0; i < n; i++) {
    const day = dateAt(i);
    const late = shift[i] >= 60;
    const wet = coin() < (late ? opts.wetIfLate ?? opts.wetBase ?? 0.25 : opts.wetBase ?? 0.25);
    drinks.set(day, wet ? 'wet' : 'dry');
    const mid = Date.parse(`${day}T03:00:00.000Z`) + Math.round(shift[i]) * 60_000;
    const L = late ? opts.later : undefined;
    const W = wet ? opts.wetEffect : undefined;
    rows.push({
      wake_date: day,
      recovery_score: 55 + 4 * common[i] + rec[i] + (L?.recovery ?? 0) + (W?.recovery ?? 0),
      hrv_rmssd_ms: 60 + 4 * common[i] + hrv[i] + (L?.hrv ?? 0) + (W?.hrv ?? 0),
      resting_heart_rate: 55 - common[i] + rhr[i] + (L?.rhr ?? 0) + (W?.rhr ?? 0),
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

// Every number a Finding exposes is finite or null; a pass always carries a headline.
function assertSane(fs: Finding[], what: string) {
  assert.equal(fs.length, REGISTERED_TESTS.length, what);
  for (const f of fs) {
    // Numbers on an 'insufficient' finding are never shown, so only text and non-insufficient numbers are held to this
    // here; the dedicated 'no NaN anywhere' test below holds every field of every finding to it.
    if (f.status !== 'insufficient') {
      for (const [k, v] of Object.entries({ n: f.n, ess: f.ess, effect: f.effect, lo: f.lo, hi: f.hi })) {
        assert.ok(v === null || Number.isFinite(v), `${what}: ${f.id} (${f.status}).${k} = ${v}`);
      }
    }
    assert.ok(!/NaN|Infinity|undefined/.test(`${f.progress} ${f.headline ?? ''}`), `${what}: ${f.id} text "${f.progress}" "${f.headline}"`);
    if (f.status === 'pass') assert.ok(f.headline, `${what}: ${f.id} passed without a headline`);
  }
}
const passing = (fs: Finding[]) => fs.filter((f) => f.status === 'pass').map((f) => f.id);

// ─── 1. false positives under the null ─────────────────────────────────────

describe('stress 1: false positives under the null', () => {
  test('no real effect, AR(1) rho 0.3-0.6 on all three outcomes: pass rate per test and family-wise', () => {
    const seeds = 24 * SCALE;
    const passes: Record<string, number> = {};
    for (const id of REGISTERED_TESTS) passes[id] = 0;
    let any = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const meta = stream(seed * 7919, 99);
      const rho = 0.3 + 0.3 * meta();
      const n = 300 + Math.floor(150 * meta());
      const { rows, drinks } = sim({ n, rho }, seed * 7919);
      const fs = runH0(rows, 'UTC', drinks);
      assertSane(fs, `seed ${seed}`);
      const p = passing(fs);
      for (const id of p) passes[id]++;
      if (p.length) any++;
    }
    log(`null (${seeds} seeds, n 300-450): family ${any}/${seeds} = ${pct(any, seeds)}; per test (alpha each ${ALPHA_FAMILYWISE.toFixed(4)}): ` +
      Object.entries(passes).map(([id, k]) => `${id}=${k}`).join(' '));
    // Family-wise should be <= 5%; the 8% bar is 2 SD of binomial noise above it at
    // 72+ seeds. At 24 seeds one chance pass is already 4%, so only a gross failure is
    // asserted there. Each test's nominal rate is 0.4%; 2% leaves room for noise.
    // (The HAC-only engine read 8-17% family-wise on stats-calibration's cells.)
    assert.ok(any / seeds <= (HEAVY ? 0.08 : 0.2), `family-wise false-positive rate ${pct(any, seeds)} (${any}/${seeds}) is inflated; the SE/ESS correction is not holding`);
    if (HEAVY) {
      for (const [id, k] of Object.entries(passes)) {
        assert.ok(k / seeds <= 0.02, `${id} passed ${k}/${seeds} under the null (nominal ${(ALPHA_FAMILYWISE * 100).toFixed(2)}%)`);
      }
    }
  });

  test('same, with white-noise outcomes (rho 0): the corrections must at least hold when there is nothing to correct', () => {
    const seeds = 10 * SCALE;
    let any = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const { rows, drinks } = sim({ n: 400, rho: 0 }, seed * 104729);
      if (passing(runH0(rows, 'UTC', drinks)).length) any++;
    }
    log(`null rho=0 (${seeds} seeds): family ${any}/${seeds} = ${pct(any, seeds)}`);
    assert.ok(any / seeds <= 0.15, `white-noise family rate ${pct(any, seeds)}`);
  });
});

// ─── 2. the confounding trap ───────────────────────────────────────────────
// Drinking makes late nights likelier (60% vs 10%) and alone lowers HRV 35 ms,
// recovery 12, raises RHR 3 bpm. Timing itself does nothing.

const TRAP: SimOpts = {
  n: 400, wetBase: 0.1, wetIfLate: 0.6,
  wetEffect: { recovery: -12, hrv: -35, rhr: 3 },
};
const H2A = REGISTERED_TESTS.filter((id) => id.startsWith('H2a'));

describe('stress 2: confounding trap (timing has no effect, drinking does)', () => {
  test('with the full drink map, H2a does not pass', () => {
    const seeds = 10 * SCALE;
    let cells = 0, hits = 0;
    const hitIds: string[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const { rows, drinks } = sim(TRAP, seed * 31337);
      const fs = runH0(rows, 'UTC', drinks);
      assertSane(fs, `seed ${seed}`);
      for (const id of H2A) { cells++; if (byId(fs, id).status === 'pass') { hits++; hitIds.push(`${seed}:${id}`); } }
    }
    log(`trap, full drink map (${seeds} seeds): H2a passes ${hits}/${cells} = ${pct(hits, cells)} ${hitIds.join(' ')}`);
    assert.ok(hits / cells <= 0.02, `H2a passed in ${hits}/${cells} cells although only drinking has an effect: ${hitIds.join(' ')}`);
  });

  test('drinking not known: every H2 test says so and none passes', () => {
    const { rows } = sim(TRAP, 11);
    const fs = runH0(rows, 'UTC'); // default empty map
    log('trap, no drink map: ' + fs.filter((f) => f.id.startsWith('H2')).slice(0, 2).map((f) => `${f.id} ${f.status} "${f.progress}"`).join(' | '));
    assertSane(fs, 'no map');
    for (const f of fs.filter((x) => x.id.startsWith('H2'))) {
      assert.equal(f.status, 'insufficient', f.id);
      assert.equal(f.n, 0, `${f.id} used rows without a known drinking status`);
      assert.match(f.progress, /^need 5 drinking nights to take drinking out, have 0$/, f.id);
    }
  });

  test('drinking known ONLY on drinking days (wet-only map): no dry comparison, so no H2 result', () => {
    const { rows, drinks } = sim(TRAP, 12);
    const wetOnly: DrinkMap = new Map([...drinks].filter(([, s]) => s === 'wet'));
    const fs = runH0(rows, 'UTC', wetOnly);
    assertSane(fs, 'wet-only');
    log('trap, wet-only map: ' + fs.filter((f) => f.id.startsWith('H2')).slice(0, 1).map((f) => `${f.id} ${f.status} "${f.progress}" drink=${JSON.stringify(f.drink)}`).join(''));
    for (const f of fs.filter((x) => x.id.startsWith('H2'))) {
      assert.equal(f.status, 'insufficient', f.id);
      assert.deepEqual(f.drink, { wet: f.drink!.wet, dry: 0 }, f.id);
      assert.match(f.progress, /^need 5 dry nights to take drinking out, have 0$/, f.id);
    }
  });

  test('a map that calls every unknown night dry (constant drinking column) does not crash or pass', () => {
    const { rows, drinks } = sim(TRAP, 13);
    const allDry: DrinkMap = new Map([...drinks.keys()].map((d) => [d, 'dry' as const]));
    const fs = runH0(rows, 'UTC', allDry);
    assertSane(fs, 'all-dry');
    assert.deepEqual(passing(fs).filter((id) => id.startsWith('H2')), []);
  });

  test('REPORT ONLY: half of the real drinking nights logged as dry (missing log read as dry)', () => {
    const seeds = 5 * SCALE;
    let cells = 0, hits = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const { rows, drinks } = sim(TRAP, seed * 31337);
      const coin = stream(seed * 31337, 50);
      const miss: DrinkMap = new Map();
      for (const [d, s] of drinks) miss.set(d, s === 'wet' && coin() < 0.5 ? 'dry' : s);
      const fs = runH0(rows, 'UTC', miss);
      for (const id of H2A) { cells++; if (byId(fs, id).status === 'pass') hits++; }
    }
    log(`trap, 50% of drinking nights mislabelled dry (${seeds} seeds): H2a passes ${hits}/${cells} = ${pct(hits, cells)} (residual confounding; informational)`);
  });
});

// ─── 3. power ──────────────────────────────────────────────────────────────

describe('stress 3: planted effect is found, in the right direction, with the right words', () => {
  test('later band: recovery -8, HRV -10 ms, RHR +3 bpm', () => {
    const seeds = 6 * SCALE;
    const hit = { recovery: 0, hrv: 0, rhr: 0 };
    // Passes whose CI misses the planted size. A point estimate can sit anywhere in
    // its CI, so a fixed distance from the truth is not the check; coverage is.
    const miss = { recovery: 0, hrv: 0, rhr: 0 };
    let wrongSide = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const { rows, drinks } = sim({ n: 400, later: { recovery: -8, hrv: -10, rhr: 3 }, wetEffect: { recovery: -6, hrv: -10, rhr: 2 } }, seed * 2713);
      const fs = runH0(rows, 'UTC', drinks);
      assertSane(fs, `seed ${seed}`);
      const rec = byId(fs, 'H2a-later-recovery'), hrv = byId(fs, 'H2a-later-hrv'), rhr = byId(fs, 'H2a-later-rhr');
      if (rec.status === 'pass') {
        hit.recovery++;
        assert.ok(rec.effect! < 0 && rec.worse === true, `recovery effect ${rec.effect} worse=${rec.worse}`);
        assert.match(rec.headline!, /^Asleep an hour or more later than usual: recovery about \d+ points lower \(−?\d+ to −?\d+\)\.$/);
        if (!(rec.lo! <= -8 && rec.hi! >= -8)) miss.recovery++;
      }
      if (hrv.status === 'pass') {
        hit.hrv++;
        assert.ok(hrv.effect! < 0 && hrv.worse === true, `hrv effect ${hrv.effect}`);
        assert.match(hrv.headline!, /^Asleep an hour or more later than usual: HRV about \d+ ms lower that night \(−?\d+ to −?\d+\)\.$/);
        if (!(hrv.lo! <= -10 && hrv.hi! >= -10)) miss.hrv++;
      }
      if (rhr.status === 'pass') {
        hit.rhr++;
        // The harmful direction for RHR is UP: higher must read as worse.
        assert.ok(rhr.effect! > 0 && rhr.worse === true, `rhr effect ${rhr.effect} worse=${rhr.worse}`);
        assert.match(rhr.headline!, /^Asleep an hour or more later than usual: resting heart rate about \d+ bpm higher \(−?\d+ to −?\d+\)\.$/);
        if (!(rhr.lo! <= 3 && rhr.hi! >= 3)) miss.rhr++;
      }
      // a passing contrast must never point the benign way here
      for (const f of fs.filter((x) => x.id.startsWith('H2a-later') && x.status === 'pass')) if (f.worse !== true) wrongSide++;
    }
    log(`power (${seeds} seeds, n=400): detected recovery ${hit.recovery}, HRV ${hit.hrv}, RHR ${hit.rhr} of ${seeds}; CI missed the truth ${miss.recovery}/${miss.hrv}/${miss.rhr}; wrong-direction passes ${wrongSide}`);
    assert.equal(wrongSide, 0);
    for (const [k, v] of Object.entries(hit)) assert.ok(v / seeds >= 0.75, `${k} detected in only ${v}/${seeds}`);
    // A 99.6% CI (alpha 0.05 over 12 tests) may miss the truth now and then; more than one miss in ten passes is a bias.
    for (const [k, v] of Object.entries(miss)) assert.ok(v <= Math.max(1, Math.ceil(0.1 * seeds)), `${k}: the CI missed the planted size in ${v}/${seeds} seeds`);
  });

  test('a planted RHR rise is not reported as an improvement (sign flips with direction)', () => {
    // RHR lower on late nights: must pass as "lower" with worse === false.
    const { rows, drinks } = sim({ n: 400, later: { recovery: 0, hrv: 0, rhr: -3 } }, 77);
    const f = byId(runH0(rows, 'UTC', drinks), 'H2a-later-rhr');
    assert.equal(f.status, 'pass');
    assert.equal(f.worse, false);
    assert.match(f.headline!, /resting heart rate about \d+ bpm lower/);
  });
});

// ─── 4. gates ──────────────────────────────────────────────────────────────
// Deterministic fixture: sleep midpoint is 03:00 UTC with +-10 min jitter except on
// chosen nights, which are moved +-90 min. Events are >=13 days apart, so the
// 28-day median never moves and every event night lands exactly in its band.

function gateFixture(o: { n?: number; later: number; earlier: number; wet: number[]; rho?: number; seed?: number }) {
  const n = o.n ?? 200;
  const seed = o.seed ?? 99;
  const rho = o.rho ?? 0.3;
  const rec = ar1(n, rho, 8, stream(seed, 0)), hrv = ar1(n, rho, 8, stream(seed, 1)), rhr = ar1(n, rho, 2, stream(seed, 2));
  const sleep = ar1(n, 0.3, 20, stream(seed, 3)), strain = ar1(n, 0.3, 3, stream(seed, 4));
  const jitter = stream(seed, 5);
  const laterAt = new Set(Array.from({ length: o.later }, (_, k) => 20 + 13 * k));
  const earlierAt = new Set(Array.from({ length: o.earlier }, (_, k) => 26 + 13 * k));
  const wetAt = new Set(o.wet);
  const rows: CycleRow[] = [];
  const drinks: DrinkMap = new Map();
  for (let i = 0; i < n; i++) {
    const day = dateAt(i);
    const off = laterAt.has(i) ? 90 : earlierAt.has(i) ? -90 : 0;
    const mid = Date.parse(`${day}T03:00:00.000Z`) + Math.round(off + (jitter() - 0.5) * 20) * 60_000;
    drinks.set(day, wetAt.has(i) ? 'wet' : 'dry');
    rows.push({
      wake_date: day, recovery_score: 55 + rec[i], hrv_rmssd_ms: 60 + hrv[i], resting_heart_rate: 55 + rhr[i],
      day_strain: 10 + strain[i],
      sleep_start: new Date(mid - 4 * 3_600_000).toISOString(), sleep_end: new Date(mid + 4 * 3_600_000).toISOString(),
      total_sleep_minutes: Math.round(420 + sleep[i]), deep_sleep_minutes: 90, step_count: 9000,
    });
  }
  return { rows, drinks };
}
const everyFourth = Array.from({ length: 49 }, (_, k) => 16 + 4 * k);
const h2aOnly = (fs: Finding[]) => fs.filter((f) => f.id.startsWith('H2a'));

describe('stress 4: gates at the boundary', () => {
  test('9 later nights: every H2a finding is held back and says need 10 later nights, have 9', () => {
    const { rows, drinks } = gateFixture({ later: 9, earlier: 10, wet: everyFourth });
    const fs = runH0(rows, 'UTC', drinks);
    assertSane(fs, '9 later');
    for (const f of h2aOnly(fs)) {
      assert.equal(f.bands!.later, 9, f.id);
      assert.ok(f.bands!.earlier >= 10 && f.bands!.near >= 10);
      assert.equal(f.status, 'insufficient', f.id);
      assert.equal(f.progress, 'need 10 later nights, have 9', f.id);
      assert.equal(progressSentence(f.progress), 'Needs 10 later nights; has 9.');
      assert.equal(f.headline, null);
    }
  });

  test('9 earlier nights name the earlier band', () => {
    const { rows, drinks } = gateFixture({ later: 10, earlier: 9, wet: everyFourth });
    for (const f of h2aOnly(runH0(rows, 'UTC', drinks))) {
      assert.equal(f.bands!.earlier, 9);
      assert.equal(f.progress, 'need 10 earlier nights, have 9', f.id);
    }
  });

  test('exactly 10 in each band opens the gate (it may be unclear, never insufficient on a band)', () => {
    const { rows, drinks } = gateFixture({ later: 10, earlier: 10, wet: everyFourth });
    const fs = runH0(rows, 'UTC', drinks);
    assertSane(fs, '10 each');
    for (const f of h2aOnly(fs)) {
      assert.deepEqual([f.bands!.earlier, f.bands!.later], [10, 10]);
      assert.notEqual(f.status, 'insufficient', `${f.id}: ${f.progress}`);
    }
    assert.deepEqual(passing(fs), [], 'no effect was planted');
  });

  test('4 drinking nights hold every H2 test back; exactly 5 opens the drinking gate', () => {
    const four = gateFixture({ later: 10, earlier: 10, wet: [40, 70, 100, 130] });
    for (const f of runH0(four.rows, 'UTC', four.drinks).filter((x) => x.id.startsWith('H2'))) {
      assert.equal(f.drink!.wet, 4, f.id);
      assert.equal(f.status, 'insufficient', f.id);
      assert.equal(f.progress, 'need 5 drinking nights to take drinking out, have 4', f.id);
      assert.equal(progressSentence(f.progress), 'Needs 5 drinking nights to take drinking out; has 4.');
    }
    const five = gateFixture({ later: 10, earlier: 10, wet: [40, 70, 100, 130, 160] });
    for (const f of runH0(five.rows, 'UTC', five.drinks).filter((x) => x.id.startsWith('H2a'))) {
      assert.equal(f.drink!.wet, 5);
      assert.notEqual(f.status, 'insufficient', `${f.id}: ${f.progress}`);
    }
  });

  test('4 dry nights hold every H2 test back; exactly 5 opens the dry gate', () => {
    const allBut = (dry: number[]) => Array.from({ length: 185 }, (_, k) => 15 + k).filter((i) => !dry.includes(i));
    const four = gateFixture({ later: 10, earlier: 10, wet: allBut([40, 70, 100, 130]) });
    for (const f of runH0(four.rows, 'UTC', four.drinks).filter((x) => x.id.startsWith('H2a'))) {
      assert.equal(f.drink!.dry, 4, f.id);
      assert.equal(f.status, 'insufficient');
      assert.equal(f.progress, 'need 5 dry nights to take drinking out, have 4', f.id);
    }
    const five = gateFixture({ later: 10, earlier: 10, wet: allBut([40, 70, 100, 130, 160]) });
    for (const f of runH0(five.rows, 'UTC', five.drinks).filter((x) => x.id.startsWith('H2a'))) {
      assert.equal(f.drink!.dry, 5);
      assert.notEqual(f.status, 'insufficient', `${f.id}: ${f.progress}`);
    }
  });

  test('effective sample size one below 30 is held back with the right sentence; 30 is let through', () => {
    // Blend white noise with a slow AR(0.95) drift in recovery; more drift = lower ESS. Bisect the blend
    // until the engine's own ESS steps from 30 to 29, then test both sides of that step.
    const base = sim({ n: 400, rho: 0.3 }, 4242);
    const white = ar1(400, 0, 8, stream(1, 0)), slow = ar1(400, 0.95, 8, stream(2, 0));
    const at = (lam: number) => {
      const rows = base.rows.map((r, i) => ({ ...r, recovery_score: 55 + (1 - lam) * white[i] + lam * slow[i] }));
      return byId(runH0(rows, 'UTC', base.drinks), 'H2a-later-recovery');
    };
    let lo = 0, hi = 1; // ess(lo) >= 30 > ess(hi)
    let f30 = at(lo), f29 = at(hi);
    assert.ok(f30.ess >= 30 && f29.ess < 30, `bracket failed: ess ${f30.ess} .. ${f29.ess}`);
    for (let k = 0; k < 16 && !(f30.ess === 30 && f29.ess === 29); k++) {
      const mid = (lo + hi) / 2;
      const f = at(mid);
      if (f.ess >= 30) { lo = mid; f30 = f; } else { hi = mid; f29 = f; }
    }
    log(`ess boundary: lambda ${lo.toFixed(5)} -> ess ${f30.ess}; ${hi.toFixed(5)} -> ess ${f29.ess}`);
    assert.equal(f29.ess, 29); assert.equal(f30.ess, 30);
    for (const b of ['earlier', 'near', 'later'] as const) assert.ok(f29.bands![b] >= 10 && f30.bands![b] >= 10, `band ${b} short, test cannot isolate ESS`);
    assert.equal(f29.status, 'insufficient');
    assert.equal(f29.headline, null);
    assert.equal(f29.progress, '29 of 30 effective days');
    assert.equal(progressSentence(f29.progress), 'Has 29 of the 30 days of data it needs.');
    assert.notEqual(f30.status, 'insufficient', `ESS 30 should clear the ESS gate: ${f30.progress}`);
  });
});

// ─── 5. degenerate input ───────────────────────────────────────────────────

function allIdentical(n: number): CycleRow[] {
  return Array.from({ length: n }, (_, i) => ({
    wake_date: dateAt(i), recovery_score: 60, hrv_rmssd_ms: 55, resting_heart_rate: 52, day_strain: 10,
    sleep_start: `${dateAt(i)}T00:00:00.000Z`, sleep_end: `${dateAt(i)}T08:00:00.000Z`,
    total_sleep_minutes: 420, deep_sleep_minutes: 90, step_count: 9000,
  }));
}
const mapFor = (rows: CycleRow[], every = 4): DrinkMap => new Map(rows.map((r, i) => [r.wake_date, i % every === 0 ? 'wet' : 'dry']));

describe('stress 5: degenerate input', () => {
  test('every night identical (all values constant): no exception, NaN or pass', () => {
    const rows = allIdentical(300);
    const fs = runH0(rows, 'UTC', mapFor(rows));
    assertSane(fs, 'identical');
    assert.deepEqual(passing(fs), []);
    for (const f of h2aOnly(fs)) { assert.equal(f.bands!.earlier + f.bands!.later, 0, f.id); assert.equal(f.status, 'insufficient'); assert.match(f.progress, /^need 10 (earlier|later) nights, have 0$/); }
  });

  test('identical nights, noisy outcomes: bands empty, held back', () => {
    const rand = stream(5, 0);
    const rows = allIdentical(300).map((r) => ({ ...r, recovery_score: 60 + gaussian(rand) * 8, hrv_rmssd_ms: 55 + gaussian(rand) * 8, resting_heart_rate: 52 + gaussian(rand) * 2, day_strain: 10 + gaussian(rand) }));
    const fs = runH0(rows, 'UTC', mapFor(rows));
    assertSane(fs, 'identical nights');
    assert.deepEqual(passing(fs), []);
  });

  test('a constant confounder (singular design) never passes and never prints NaN', () => {
    // total sleep identical every night, or strain identical every day: that confounder column is
    // constant, X'X is singular, and the fit must say "cannot tell", not "pass".
    const make = (patch: Partial<CycleRow>) => {
      const base = sim({ n: 350, rho: 0.3 }, 61);
      return { rows: base.rows.map((r) => ({ ...r, ...patch })), drinks: base.drinks };
    };
    const cases: [string, Partial<CycleRow>][] = [
      ['constant total sleep', { total_sleep_minutes: 420 }],
      ['constant strain', { day_strain: 10 }],
    ];
    const bad: string[] = [];
    for (const [name, patch] of cases) {
      const { rows, drinks } = make(patch);
      for (const f of runH0(rows, 'UTC', drinks)) {
        const nan = [f.effect, f.lo, f.hi, f.ess].some((v) => v !== null && !Number.isFinite(v));
        if (f.status === 'pass' || nan) bad.push(`${name}: ${f.id} ${f.status} effect=${f.effect} headline=${f.headline}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('no NaN or Infinity in any field of any finding, even held-back ones (wet-only map, all-dry map, identical nights)', () => {
    const base = sim(TRAP, 12);
    const wetOnly: DrinkMap = new Map([...base.drinks].filter(([, s]) => s === 'wet'));
    const allDry: DrinkMap = new Map([...base.drinks.keys()].map((d) => [d, 'dry' as const]));
    const ident = allIdentical(300);
    const runs: [string, Finding[]][] = [
      ['wet-only', runH0(base.rows, 'UTC', wetOnly)],
      ['all-dry', runH0(base.rows, 'UTC', allDry)],
      ['identical', runH0(ident, 'UTC', mapFor(ident))],
    ];
    const bad: string[] = [];
    for (const [name, fs] of runs) {
      for (const f of fs) for (const [k, v] of Object.entries({ ess: f.ess, effect: f.effect, lo: f.lo, hi: f.hi })) {
        if (v !== null && !Number.isFinite(v)) bad.push(`${name}/${f.id}.${k}=${v}`);
      }
    }
    assert.deepEqual(bad.slice(0, 8), [], `${bad.length} non-finite fields`);
  });

  test('constant outcomes with real timing variation: never a pass from a zero standard error', () => {
    const base = sim({ n: 350, rho: 0.3 }, 21);
    const rows = base.rows.map((r) => ({ ...r, recovery_score: 61.3, hrv_rmssd_ms: 47, resting_heart_rate: 58 }));
    const fs = runH0(rows, 'UTC', base.drinks);
    assertSane(fs, 'constant outcome');
    const bad = fs.filter((f) => f.status === 'pass' && /^H(2|0a|0d)/.test(f.id) && f.id !== 'H0d' && !f.id.startsWith('H0a'));
    log('constant outcomes: statuses ' + fs.map((f) => `${f.id}:${f.status}`).join(' '));
    assert.deepEqual(passing(fs), [], `constant outcomes passed: ${bad.map((f) => `${f.id} effect=${f.effect} lo=${f.lo} hi=${f.hi}`).join('; ')}`);
  });

  test('constant (but integer-rounded) recovery that only moves in steps: no exception', () => {
    const base = sim({ n: 350, rho: 0.3 }, 22);
    const rows = base.rows.map((r) => ({ ...r, recovery_score: Math.round((r.recovery_score ?? 0) / 40) * 40 }));
    assertSane(runH0(rows, 'UTC', base.drinks), 'stepped');
  });

  test('70% of outcome and sleep values null: no exception or pass', () => {
    const rand = stream(31, 50);
    const base = sim({ n: 400, rho: 0.4 }, 31);
    const rows = base.rows.map((r) => ({
      ...r,
      recovery_score: rand() < 0.7 ? null : r.recovery_score,
      hrv_rmssd_ms: rand() < 0.7 ? null : r.hrv_rmssd_ms,
      resting_heart_rate: rand() < 0.7 ? null : r.resting_heart_rate,
      total_sleep_minutes: rand() < 0.3 ? null : r.total_sleep_minutes,
      sleep_start: rand() < 0.3 ? null : r.sleep_start,
      day_strain: rand() < 0.3 ? null : r.day_strain,
    }));
    const fs = runH0(rows, 'UTC', base.drinks);
    assertSane(fs, 'many nulls');
    assert.deepEqual(passing(fs), []);
  });

  test('every value null; empty input; one row; NaN and Infinity fields', () => {
    const empty = runH0([], 'UTC');
    assertSane(empty, 'empty');
    assert.deepEqual(passing(empty), []);
    const one = allIdentical(1);
    assertSane(runH0(one, 'UTC', mapFor(one)), 'one row');
    const nulls: CycleRow[] = Array.from({ length: 200 }, (_, i) => ({
      wake_date: dateAt(i), recovery_score: null, hrv_rmssd_ms: null, resting_heart_rate: null, day_strain: null,
      sleep_start: null, sleep_end: null, total_sleep_minutes: null, deep_sleep_minutes: null, step_count: null,
    }));
    const fn = runH0(nulls, 'UTC', mapFor(nulls));
    assertSane(fn, 'all null');
    assert.deepEqual(passing(fn), []);
    const odd = sim({ n: 300 }, 8);
    const rows = odd.rows.map((r, i) => (i % 7 === 0 ? { ...r, recovery_score: NaN, hrv_rmssd_ms: Infinity, resting_heart_rate: -Infinity } : r));
    assertSane(runH0(rows, 'UTC', odd.drinks), 'NaN/Infinity');
  });

  test('duplicate wake_dates (conflicting copies): same result as the de-duplicated series, no crash', () => {
    const base = sim({ n: 320, rho: 0.4 }, 41);
    const dup = [...base.rows, ...base.rows.slice(50, 120).map((r) => ({ ...r, recovery_score: 5, hrv_rmssd_ms: 5 }))];
    const fs = runH0(dup, 'UTC', base.drinks);
    assertSane(fs, 'duplicates');
    // the engine keeps the LAST copy of a date, so the conflicting copies decide the result
    const kept = new Map<string, CycleRow>();
    for (const r of dup) kept.set(r.wake_date, r);
    const ref = runH0([...kept.values()], 'UTC', base.drinks);
    assert.deepEqual(fs.map((f) => [f.id, f.n, f.status]), ref.map((f) => [f.id, f.n, f.status]));
    for (const f of fs) assert.ok(f.n <= 320, `${f.id} counted ${f.n} rows from 320 dates`);
    assert.deepEqual(passing(fs), []);
  });

  test('a 60-day gap in the middle: lags stay calendar-true, no crash, and the gap creates no pass of its own', () => {
    const base = sim({ n: 460, rho: 0.4 }, 51);
    const rows = base.rows.filter((_, i) => i < 200 || i >= 260);
    const fs = runH0(rows, 'UTC', base.drinks);
    assertSane(fs, 'gap');
    for (const f of fs) assert.ok(f.n <= 400, `${f.id} n=${f.n}`);
    // One null history passes some test in ~5% of seeds by design (this seed does, on
    // H2a-later-rhr, gap or no gap), so "no pass" is not the check; the gap not adding one is.
    const whole = passing(runH0(base.rows, 'UTC', base.drinks));
    const added = passing(fs).filter((id) => !whole.includes(id));
    log(`gap: passes with the gap ${passing(fs).join(',') || 'none'}; without it ${whole.join(',') || 'none'}`);
    assert.deepEqual(added, [], `the gap alone produced a pass: ${added.join(', ')}`);
  });

  test('a planted effect straddling a 60-day gap still reads the right direction (or stays quiet)', () => {
    const base = sim({ n: 460, rho: 0.4, later: { recovery: -8, hrv: -10, rhr: 3 } }, 52);
    const rows = base.rows.filter((_, i) => i < 200 || i >= 260);
    const fs = runH0(rows, 'UTC', base.drinks);
    assertSane(fs, 'gap + effect');
    for (const f of fs.filter((x) => x.id.startsWith('H2a-later') && x.status === 'pass')) assert.equal(f.worse, true, f.id);
  });
});
