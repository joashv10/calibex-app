// CALIBEX statistics engine.
//
// Pure module: no app imports, no "use client", no I/O. Runs identically in
// the browser bundle and under `node --test`.
//
// Statistical honesty is the point of this file (see CORRELATION_RULES.md): daily health data is autocorrelated, so naive Pearson correlation
// on it inflates confidence and produces false positives. Every hypothesis
// here is fit on deviations from a rolling personal baseline, corrected for
// lag-1 autocorrelation (effective sample size) and for autocorrelation in
// BOTH the exposure and the residuals (the larger of a Newey-West HAC and a
// Bartlett long-run standard error, see seForX), then gated before it is
// allowed to surface. Below the gate, the app must say "not enough signal
// yet" rather than confabulate a pattern.

export type CycleRow = {
  wake_date: string; // 'YYYY-MM-DD'
  recovery_score: number | null;
  hrv_rmssd_ms: number | null;
  resting_heart_rate: number | null;
  day_strain: number | null;
  sleep_start: string | null; // ISO timestamptz
  sleep_end: string | null;
  total_sleep_minutes: number | null;
  deep_sleep_minutes: number | null;
  // WHOOP steps for that wake_date's day (wake to next sleep); null when the strap wasn't worn.
  // Optional so rows from before the column existed still type-check.
  step_count?: number | null;
};

type Series = (number | null)[];

// ─── calendar + local-time helpers ─────────────────────────────────────────

function parseDateUTC(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatDateUTC(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Sorts rows by wake_date and fills any missing calendar days with null rows,
// so every lag below is calendar-true (never "next available row").
function expandCalendar(rows: CycleRow[]): { dates: string[]; byDate: Map<string, CycleRow> } {
  const byDate = new Map<string, CycleRow>();
  for (const r of rows) byDate.set(r.wake_date, r);
  const sorted = [...byDate.keys()].sort();
  if (sorted.length === 0) return { dates: [], byDate };
  const startMs = parseDateUTC(sorted[0]);
  const endMs = parseDateUTC(sorted[sorted.length - 1]);
  const dates: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) dates.push(formatDateUTC(ms));
  return { dates, byDate };
}

function numericField(row: CycleRow | undefined, key: keyof CycleRow): number | null {
  if (!row) return null;
  const v = row[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function seriesOf(dates: string[], byDate: Map<string, CycleRow>, key: keyof CycleRow): Series {
  return dates.map((d) => numericField(byDate.get(d), key));
}

function localHM(d: Date, tz: string): { h: number; m: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')!.value);
  const m = Number(parts.find((p) => p.type === 'minute')!.value);
  return { h, m };
}

function minutesSince18FromDate(d: Date, tz: string): number {
  const { h, m } = localHM(d, tz);
  return (((h - 18) * 60 + m) % 1440 + 1440) % 1440;
}

// Minutes since local 18:00 in tz (0..1439), so a night is continuous
// (23:30 -> 330, 01:30 -> 450) and a daytime sleep (10:19) reads very late
// (983), not early. The wrap sits at 18:00, when nobody is going to bed.
export function nightMinutes(iso: string, tz: string): number {
  return minutesSince18FromDate(new Date(iso), tz);
}

function bedtimeSeriesOf(dates: string[], byDate: Map<string, CycleRow>, tz: string): Series {
  return dates.map((d) => {
    const r = byDate.get(d);
    return r?.sleep_start ? nightMinutes(r.sleep_start, tz) : null;
  });
}

function midpointSeriesOf(dates: string[], byDate: Map<string, CycleRow>, tz: string): Series {
  return dates.map((d) => {
    const r = byDate.get(d);
    if (!r?.sleep_start || !r?.sleep_end) return null;
    const ms = (new Date(r.sleep_start).getTime() + new Date(r.sleep_end).getTime()) / 2;
    return minutesSince18FromDate(new Date(ms), tz);
  });
}

function median(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Median of the `window` values strictly before index i (nulls ignored);
// null if fewer than minN values are available.
export function normalAt(series: Series, i: number, window = 28, minN = 14): number | null {
  const start = Math.max(0, i - window);
  const vals: number[] = [];
  for (let j = start; j < i; j++) {
    const v = series[j];
    if (v !== null && v !== undefined && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length < minN) return null;
  return median(vals);
}

// Signed distance from `usual` on the 24 h clock, wrapped into (-720, +720] minutes, so
// a sleep centred 17:30 and one centred 18:30 are an hour apart, not 23 (the 18:00 seam
// of nightMinutes is where the scale wraps, not where the clock does).
export const wrapDev = (minutes: number): number => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return m > 720 ? m - 1440 : m;
};

// The Body clock's "this week" figure for the night at index i of a null-filled
// midpoint series: median |midpoint − its own 28-day usual| over the 7 nights
// ending at i, needing minN of them (value null below that). Shared with
// bodyClock.ts so the card and the H2b test measure irregularity one way.
export function weekIrregularityAt(
  mids: Series,
  i: number,
  minN = 5,
): { value: number | null; have: number } {
  const ds: number[] = [];
  for (let j = Math.max(0, i - 6); j <= i; j++) {
    const v = mids[j];
    if (v === null || v === undefined) continue;
    const u = normalAt(mids, j);
    if (u === null) continue;
    ds.push(Math.abs(wrapDev(v - u)));
  }
  return { value: ds.length >= minN ? median(ds) : null, have: ds.length };
}

// Deviation of series[i] from its own rolling normal; null if either is
// missing. Bounds-safe for i out of range. `circular` is for clock-time series
// (sleep midpoint): the deviation wraps at 24 h, see wrapDev.
function devAt(series: Series, i: number, circular = false): number | null {
  if (i < 0 || i >= series.length) return null;
  const v = series[i];
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const norm = normalAt(series, i);
  if (norm === null) return null;
  return circular ? wrapDev(v - norm) : v - norm;
}

// For the row on `day`: value, the 28-day normal before it, and the delta.
export function vsNormal(
  rows: CycleRow[],
  day: string,
  key: keyof CycleRow,
): { value: number; normal: number; delta: number } | null {
  const { dates, byDate } = expandCalendar(rows);
  const i = dates.indexOf(day);
  if (i < 0) return null;
  const series = seriesOf(dates, byDate, key);
  const value = series[i];
  if (value === null) return null;
  const normal = normalAt(series, i);
  if (normal === null) return null;
  return { value, normal, delta: value - normal };
}

// True when the bedtime of the night ending on `day` is > 60 min later than
// the 28-day normal bedtime.
export function lateNight(rows: CycleRow[], day: string, tz: string): boolean {
  const { dates, byDate } = expandCalendar(rows);
  const i = dates.indexOf(day);
  if (i < 0) return false;
  const bedtime = bedtimeSeriesOf(dates, byDate, tz);
  const value = bedtime[i];
  if (value === null) return false;
  const normal = normalAt(bedtime, i);
  if (normal === null) return false;
  return value - normal > 60;
}

// ─── morning headline: personal-best run lengths ───────────────────────────

type HeadlineMetric = { key: keyof CycleRow; dir: 'max' | 'min'; phrase: string };

const HEADLINE_METRICS: HeadlineMetric[] = [
  { key: 'deep_sleep_minutes', dir: 'max', phrase: 'Deepest sleep' },
  { key: 'total_sleep_minutes', dir: 'max', phrase: 'Longest sleep' },
  { key: 'hrv_rmssd_ms', dir: 'max', phrase: 'Highest HRV' },
  { key: 'recovery_score', dir: 'max', phrase: 'Best recovery' },
  { key: 'resting_heart_rate', dir: 'min', phrase: 'Lowest resting heart rate' },
];

// Number of calendar days back from i you must pass through, all worse than
// series[i], before finding one at least as good. If the whole available
// history is worse, returns i (the full history length before i).
function runLength(series: Series, i: number, dir: 'max' | 'min'): number {
  const today = series[i] as number;
  let run = 0;
  for (let j = i - 1; j >= 0; j--) {
    const v = series[j];
    if (v !== null) {
      const atLeastAsGood = dir === 'max' ? v >= today : v <= today;
      if (atLeastAsGood) return run;
    }
    run++;
  }
  return run;
}

function formatRun(days: number): string {
  if (days < 21) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

// Personal-best line for the morning of `day`, or null below 14 days.
export function morningHeadline(rows: CycleRow[], day: string): string | null {
  const { dates, byDate } = expandCalendar(rows);
  const i = dates.indexOf(day);
  if (i < 0) return null;

  let best: { phrase: string; run: number; histLen: number } | null = null;
  for (const m of HEADLINE_METRICS) {
    const series = seriesOf(dates, byDate, m.key);
    if (series[i] === null) continue;
    const run = runLength(series, i, m.dir);
    if (run < 14) continue;
    if (!best || run > best.run) best = { phrase: m.phrase, run, histLen: i };
  }
  if (!best) return null;

  const text =
    best.histLen >= 60 && best.run >= best.histLen
      ? 'since your WHOOP data starts'
      : formatRun(best.run);
  return `${best.phrase} ${text}.`;
}

// ─── linear algebra (small, dense; k <= 4) ─────────────────────────────────

function zeros(k: number): number[][] {
  return Array.from({ length: k }, () => new Array(k).fill(0));
}

function matMulAtA(X: number[][]): number[][] {
  const n = X.length;
  const k = X[0].length;
  const M = zeros(k);
  for (let t = 0; t < n; t++) {
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) M[a][b] += X[t][a] * X[t][b];
    }
  }
  return M;
}

function matVecAtY(X: number[][], y: number[]): number[] {
  const n = X.length;
  const k = X[0].length;
  const v = new Array(k).fill(0);
  for (let t = 0; t < n; t++) {
    for (let a = 0; a < k; a++) v[a] += X[t][a] * y[t];
  }
  return v;
}

// Gauss-Jordan inverse with partial pivoting.
function invert(M: number[][]): number[][] {
  const k = M.length;
  const A = M.map((row) => row.slice());
  const I: number[][] = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    [I[col], I[pivot]] = [I[pivot], I[col]];
    const pv = A[col][col];
    if (!Number.isFinite(pv) || Math.abs(pv) < 1e-12) {
      // Near-singular: return an "infinite variance" inverse so downstream
      // SEs come out Infinity rather than a false precise estimate.
      return Array.from({ length: k }, () => new Array(k).fill(Infinity));
    }
    for (let c = 0; c < k; c++) {
      A[col][c] /= pv;
      I[col][c] /= pv;
    }
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let c = 0; c < k; c++) {
        A[r][c] -= f * A[col][c];
        I[r][c] -= f * I[col][c];
      }
    }
  }
  return I;
}

function matVec(M: number[][], v: number[]): number[] {
  return M.map((row) => row.reduce((s, m, i) => s + m * v[i], 0));
}

function matMul(A: number[][], B: number[][]): number[][] {
  const k = A.length;
  const k2 = B[0].length;
  const inner = A[0].length;
  const R = zeros(Math.max(k, k2));
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k2; j++) {
      let s = 0;
      for (let l = 0; l < inner; l++) s += A[i][l] * B[l][j];
      R[i][j] = s;
    }
  }
  return R;
}

// design[t] = the exposure column(s) then the confounders for row t; the
// intercept is added here.
function fitOLS(design: number[][], ys: number[]) {
  const n = design.length;
  const k = 1 + (design[0]?.length ?? 0);
  const X: number[][] = design.map((row) => [1, ...row]);
  const XtX = matMulAtA(X);
  const Xty = matVecAtY(X, ys);
  const XtXinv = invert(XtX);
  const b = matVec(XtXinv, Xty);
  const fitted = X.map((row) => row.reduce((s, v, i) => s + v * b[i], 0));
  const resid = ys.map((y, t) => y - fitted[t]);
  return { X, b, resid, k, n, XtXinv };
}

// Lag-1 autocorrelation of residuals, over pairs of consecutive CALENDAR days
// that are both complete cases (days[] carries each row's calendar index).
function lag1Rho(resid: number[], days: number[]): number {
  let den = 0;
  for (let t = 0; t < resid.length; t++) den += resid[t] * resid[t];
  let num = 0;
  for (let t = 0; t < resid.length - 1; t++) {
    if (days[t + 1] === days[t] + 1) num += resid[t] * resid[t + 1];
  }
  const rho = den > 0 ? num / den : 0;
  return Math.min(0.95, Math.max(0, rho));
}

// Newey-West HAC standard error for coefficient `j` of X (0 = intercept),
// Bartlett kernel, over the complete-case sequence (ordinal lag, not calendar lag).
function hacSE(X: number[][], resid: number[], XtXinv: number[][], j: number): number {
  const n = X.length;
  const k = X[0].length;
  const L = Math.max(1, Math.floor(4 * Math.pow(n / 100, 2 / 9)));
  const S = zeros(k);
  for (let t = 0; t < n; t++) {
    const xt = X[t];
    const w0 = resid[t] * resid[t];
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) S[a][b] += w0 * xt[a] * xt[b];
  }
  for (let l = 1; l <= L; l++) {
    const w = 1 - l / (L + 1);
    for (let t = l; t < n; t++) {
      const xt = X[t];
      const xtl = X[t - l];
      const prod = resid[t] * resid[t - l];
      for (let a = 0; a < k; a++) {
        for (let b = 0; b < k; b++) {
          S[a][b] += w * prod * (xt[a] * xtl[b] + xtl[a] * xt[b]);
        }
      }
    }
  }
  const Vb = matMul(matMul(XtXinv, S), XtXinv);
  const v = Vb[j][j];
  return Number.isFinite(v) && v >= 0 ? Math.sqrt(v) : Infinity;
}

// Column `col` of X with the other columns (intercept, confounders) projected
// out: the part of x the slope is actually estimated from.
function residualizeCol(X: number[][], col: number): number[] {
  const Z = X.map((row) => row.filter((_, j) => j !== col));
  const x = X.map((row) => row[col]);
  const g = matVec(invert(matMulAtA(Z)), matVecAtY(Z, x));
  return x.map((v, t) => v - Z[t].reduce((s, z, j) => s + z * g[j], 0));
}

// Lag-k autocorrelation of a mean-zero series (ordinal lag over complete cases).
function acfAt(s: number[], k: number): number {
  let den = 0;
  for (const v of s) den += v * v;
  let num = 0;
  for (let t = k; t < s.length; t++) num += s[t] * s[t - k];
  return den > 0 ? num / den : 0;
}

// Longest lag the Bartlett sum below runs over: the baseline window, so the
// dependence the rolling normal itself induces is inside it.
const BARTLETT_LAGS = 28;

// Standard error of coefficient `j` of X (the reported exposure column; for
// H2a's band dummies each contrast gets its own, with the other dummy and the
// confounders projected out).
//
// Under the null the slope's variance is the OLS variance times
// F = 1 + 2·Σ_k r_x(k)·r_e(k) (Bartlett 1935; the lag-sum form of
// n·(1−ρxρe)/(1+ρxρe)), where r_x is the autocorrelation of the residualized
// exposure and r_e that of the residuals. The exposure side is observed, not
// estimated, so this factor is stable even when x is very persistent (H2b's
// 7-night rolling irregularity has lag-1 autocorrelation ~0.85). Newey-West at
// the textbook bandwidth (4-5 lags) truncates exactly that long tail and, with a
// persistent x, sits below even the OLS SE when residuals are white, which is
// what let the null false-positive rate drift to 2-3x nominal. The Bartlett SE
// is what calibrates it (simulation: slope SD / reported SE ~1.0 for AR(1) 0-0.7
// on both sides, down from 1.1-1.5); HAC is kept in a max so heteroskedasticity
// still counts. Either side non-finite -> Infinity, never a precise-looking SE.
function seForX(X: number[][], resid: number[], XtXinv: number[][], j: number): number {
  const n = X.length;
  const k = X[0].length;
  const hac = hacSE(X, resid, XtXinv, j);
  const xt = residualizeCol(X, j);
  let rss = 0;
  for (const e of resid) rss += e * e;
  const ols = Math.sqrt((rss / Math.max(1, n - k)) * XtXinv[j][j]);
  let sum = 0;
  for (let lag = 1; lag <= Math.min(BARTLETT_LAGS, n - 2); lag++) sum += acfAt(xt, lag) * acfAt(resid, lag);
  const bartlett = ols * Math.sqrt(Math.max(1, 1 + 2 * sum));
  const se = Math.max(hac, bartlett);
  return Number.isFinite(se) ? se : Infinity;
}

// ─── Student-t quantile (regularized incomplete beta + bisection) ─────────

function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(x: number, a: number, b: number): number {
  const MAXIT = 200;
  const EPS = 3e-9;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

function tCDF(t: number, df: number): number {
  if (t === 0) return 0.5;
  const x = df / (df + t * t);
  const ib = regularizedIncompleteBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - 0.5 * ib : 0.5 * ib;
}

// Exported so it can be tested directly against known values
// (t(0.975, 10) = 2.228, t(0.99375, 30) ~= 2.663).
export function tQuantile(p: number, df: number): number {
  if (p <= 0.5) return -tQuantile(1 - p, df);
  if (p >= 1) return Infinity;
  let lo = 0;
  let hi = 1;
  while (tCDF(hi, df) < p) hi *= 2;
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    if (tCDF(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ─── hypothesis engine ─────────────────────────────────────────────────────

export type FindingStatus = 'pass' | 'unclear' | 'insufficient';

// The three WHOOP outcomes the sleep tests (H2a, H2b) run on. `worseWhen` is the
// harmful direction: lower recovery or HRV, HIGHER resting heart rate.
export type Outcome = 'recovery' | 'hrv' | 'rhr';
type OutcomeSpec = {
  key: Outcome;
  field: keyof CycleRow;
  unit: Finding['unit'];
  worseWhen: 'lower' | 'higher';
  // "recovery about 4 points lower"
  phrase: (mag: number, dir: 'lower' | 'higher') => string;
};
const OUTCOMES: OutcomeSpec[] = [
  { key: 'recovery', field: 'recovery_score', unit: 'recovery points', worseWhen: 'lower',
    phrase: (mag, dir) => `recovery about ${mag} points ${dir}` },
  { key: 'hrv', field: 'hrv_rmssd_ms', unit: 'ms HRV', worseWhen: 'lower',
    phrase: (mag, dir) => `HRV about ${mag} ms ${dir} that night` },
  { key: 'rhr', field: 'resting_heart_rate', unit: 'bpm', worseWhen: 'higher',
    phrase: (mag, dir) => `resting heart rate about ${mag} bpm ${dir}` },
];

export type TimingBand = 'earlier' | 'near' | 'later';
export type TimingContrast = Exclude<TimingBand, 'near'>;
const TIMING_CONTRASTS: TimingContrast[] = ['earlier', 'later'];

export type FindingId = 'H0a1' | 'H0a2' | 'H0d' | `H2a-${TimingContrast}-${Outcome}` | `H2b-${Outcome}`;

// Every test runH0 fits, one entry per reported contrast. The family-wise alpha is
// split over this list (Bonferroni), so adding a test here tightens every other.
// H0b (bedtime, linear) and H0c (7-night SD) were retired on 2026-10-17 and
// replaced by H2a/H2b (CORRELATION_RULES.md change log); H1a/H1b are not fitted
// here and keep their own family.
export const REGISTERED_TESTS: readonly FindingId[] = [
  'H0a1', 'H0a2', 'H0d',
  ...OUTCOMES.flatMap((o) => TIMING_CONTRASTS.map((c) => `H2a-${c}-${o.key}` as const)),
  ...OUTCOMES.map((o) => `H2b-${o.key}` as const),
];
export const ALPHA_FAMILYWISE = 0.05 / REGISTERED_TESTS.length;
const ESS_NEEDED = 30;
const ARM_NEEDED = 10;
const DRINK_NEEDED = 5;

export type Finding = {
  id: FindingId;
  question: string;
  status: FindingStatus;
  n: number;
  ess: number;
  essNeeded: number;
  arms: { high: number; low: number };
  armNeeded: number;
  effect: number | null;
  lo: number | null;
  hi: number | null;
  unit: 'recovery points' | 'ms HRV' | 'bpm';
  step: string;
  headline: string | null;
  progress: string;
  // On a pass: whether the effect points the harmful way for its outcome.
  worse: boolean | null;
  // H2a only: nights in each band among the rows the test used.
  bands?: Record<TimingBand, number>;
  // H2a/H2b only: known drinking status among the rows the test used.
  drink?: { wet: number; dry: number };
};

function fmtCI(v: number): string {
  const r = Math.round(v);
  return r < 0 ? `−${Math.abs(r)}` : `${r}`;
}

// A count the test must reach before it may speak; the first one short writes the
// progress line ("need 10 late nights, have 4").
type Gate = { label: string; have: number; need: number };

type BuildParams = {
  id: FindingId;
  question: string;
  unit: Finding['unit'];
  step: string;
  design: number[][]; // per row: exposure column(s) first, then confounders
  coef: number; // index within a design row of the reported exposure
  stepMultiplier: number;
  ys: number[];
  days: number[];
  arms: Finding['arms'];
  gates: Gate[];
  worseWhen: 'lower' | 'higher';
  headlineFn: (mag: number, lo: string, hi: string, dir: 'lower' | 'higher') => string;
  bands?: Finding['bands'];
  drink?: Finding['drink'];
};

function buildFinding(p: BuildParams): Finding {
  const n = p.ys.length;
  const k = 1 + (p.design[0]?.length ?? 0);
  const base = {
    id: p.id,
    question: p.question,
    n,
    essNeeded: ESS_NEEDED,
    armNeeded: ARM_NEEDED,
    unit: p.unit,
    step: p.step,
    arms: p.arms,
    worse: null,
    ...(p.bands ? { bands: p.bands } : {}),
    ...(p.drink ? { drink: p.drink } : {}),
  };
  const shortGate = p.gates.find((g) => g.have < g.need);
  const gateLine = shortGate ? `need ${shortGate.need} ${shortGate.label}, have ${shortGate.have}` : null;

  if (n < k + 2) {
    return {
      ...base,
      status: 'insufficient',
      ess: 0,
      effect: null,
      lo: null,
      hi: null,
      headline: null,
      progress: gateLine ?? `0 of ${ESS_NEEDED} effective days`,
    };
  }

  const { X, b, resid, XtXinv } = fitOLS(p.design, p.ys);
  const rho = lag1Rho(resid, p.days);
  const ess = Math.floor((n * (1 - rho)) / (1 + rho));
  const j = 1 + p.coef;
  const se = seForX(X, resid, XtXinv, j);
  const df = Math.max(1, ess - k);
  const tcrit = tQuantile(1 - ALPHA_FAMILYWISE / 2, df);
  const effect = b[j] * p.stepMultiplier;
  const half = tcrit * se * p.stepMultiplier;
  const lo = effect - half;
  const hi = effect + half;

  // A singular design (a confounder that never varies, a band with no nights) or
  // a zero-variance outcome gives NaN or infinite estimates. NaN fails every
  // comparison, so without this it would skip the "CI covers 0" test and land on
  // 'pass'. A short gate is the better explanation when there is one (an empty
  // band is both), so it keeps its line.
  if (![ess, effect, lo, hi].every(Number.isFinite)) {
    return {
      ...base,
      status: 'insufficient',
      ess: Number.isFinite(ess) ? Math.max(0, ess) : 0,
      effect: null,
      lo: null,
      hi: null,
      headline: null,
      progress: gateLine ?? 'Not enough variation to tell yet',
    };
  }

  let status: FindingStatus;
  let progress: string;
  let headline: string | null = null;
  let worse: boolean | null = null;

  if (gateLine) {
    status = 'insufficient';
    progress = gateLine;
  } else if (ess < ESS_NEEDED) {
    status = 'insufficient';
    progress = `${Math.max(0, ess)} of ${ESS_NEEDED} effective days`;
  } else if (lo <= 0 && hi >= 0) {
    status = 'unclear';
    progress = 'Enough days, no clear effect yet';
  } else {
    status = 'pass';
    progress = `${ess} of ${ESS_NEEDED} effective days`;
    const dir: 'lower' | 'higher' = effect < 0 ? 'lower' : 'higher';
    const mag = Math.round(Math.abs(effect));
    headline = p.headlineFn(mag, fmtCI(lo), fmtCI(hi), dir);
    worse = dir === p.worseWhen;
  }

  return { ...base, status, ess, effect, lo, hi, headline, progress, worse };
}

// Two-arm gates: ARM_NEEDED days at or beyond ±armDelta on the exposure.
function armGates(xs: number[], armDelta: number, labels: { high: string; low: string }) {
  const high = xs.filter((x) => x >= armDelta).length;
  const low = xs.filter((x) => x <= -armDelta).length;
  return {
    arms: { high, low },
    gates: [
      { label: labels.high, have: high, need: ARM_NEEDED },
      { label: labels.low, have: low, need: ARM_NEEDED },
    ],
  };
}

function buildA(
  strain: Series,
  recovery: Series,
  totalSleep: Series,
  lag: 1 | 2,
  id: 'H0a1' | 'H0a2',
  question: string,
  headlineSuffix: string,
): Finding {
  const n = strain.length;
  const xs: number[] = [];
  const ys: number[] = [];
  const design: number[][] = [];
  const days: number[] = [];
  for (let D = 0; D + lag < n; D++) {
    const x = devAt(strain, D);
    const y = devAt(recovery, D + lag);
    const cSleep = devAt(totalSleep, D + lag);
    const confList: (number | null)[] = lag === 1 ? [cSleep] : [devAt(strain, D + 1), cSleep];
    if (x === null || y === null || confList.some((c) => c === null)) continue;
    xs.push(x);
    ys.push(y);
    design.push([x, ...(confList as number[])]);
    days.push(D);
  }
  return buildFinding({
    id,
    question,
    unit: 'recovery points',
    step: 'a day 2 strain harder than your normal',
    design,
    coef: 0,
    stepMultiplier: 2,
    ...armGates(xs, 2, { high: 'harder days', low: 'easier days' }),
    worseWhen: 'lower',
    headlineFn: (mag, lo, hi, dir) =>
      `A day 2 strain harder than usual: about ${mag} recovery points ${dir} ${headlineSuffix} (${lo} to ${hi}).`,
    ys,
    days,
  });
}

// H0d: a day of much less movement than your normal -> next morning's recovery.
// Same pairing as H0a1 (exposure on day D, recovery and total sleep on D+1), with
// the day's strain as a confounder: steps are part of strain, so holding it fixed
// isolates the low-movement effect. The exposure is NEGATED (steps below normal),
// so a positive x means "moved less" and the 'high' arm is the low-movement arm.
// Arm threshold 3000 steps: roughly a third of a typical 9-10k day, the same kind
// of "clearly more than noise, still common enough to fill 10 days" size that
// buildA uses for 2 strain.
const STEP_SHIFT = 3000;
function buildD(steps: Series, recovery: Series, strain: Series, totalSleep: Series): Finding {
  const n = steps.length;
  const xs: number[] = [];
  const ys: number[] = [];
  const design: number[][] = [];
  const days: number[] = [];
  for (let D = 0; D + 1 < n; D++) {
    const dev = devAt(steps, D);
    const y = devAt(recovery, D + 1);
    const c1 = devAt(strain, D);
    const c2 = devAt(totalSleep, D + 1);
    if (dev === null || y === null || c1 === null || c2 === null) continue;
    xs.push(-dev);
    ys.push(y);
    design.push([-dev, c1, c2]);
    days.push(D);
  }
  return buildFinding({
    id: 'H0d',
    question: "On a day you move much less than usual, is the next morning's recovery lower?",
    unit: 'recovery points',
    step: '3,000 fewer steps than your normal',
    design,
    coef: 0,
    stepMultiplier: STEP_SHIFT,
    ...armGates(xs, STEP_SHIFT, { high: 'low-movement days', low: 'high-movement days' }),
    worseWhen: 'lower',
    headlineFn: (mag, lo, hi, dir) =>
      `A day with 3,000 fewer steps than usual: about ${mag} recovery points ${dir} next morning (${lo} to ${hi}).`,
    ys,
    days,
  });
}

// ─── drinking: wet / dry / unknown per outcome row ─────────────────────────
// The sleep tests (H2a, H2b) hold drinking fixed, so each outcome row needs a
// known status. Three sources, each aligned to the OUTCOME row (the wake_date
// whose recovery / HRV / RHR the night produced):
//   - WHOOP journal "Have any alcoholic drinks?": answered on wake_date D about the
//     evening before, so it belongs to row D (checked on the data: yes-days average
//     recovery 21 vs 58 on D itself, and the same as dry days on D+1).
//   - Dinner check-in AL1 "Any alcohol today?": answered at dinner on logging day W,
//     so the night it affects ends on W+1. 'None' is dry, any other answer wet,
//     a skipped item unknown.
//   - Alcohol logged in Food (substance_log, substance 'alcohol') on day W: wet on W+1.
// Wet beats dry when sources disagree. A row no source covers is unknown and the
// tests leave it out; nothing is ever assumed dry.
export type DrinkStatus = 'wet' | 'dry';
export type DrinkMap = Map<string, DrinkStatus>;
export type DrinkRows = {
  journal: { wake_date: string; answered_yes: boolean | null }[];
  al1: { wake_date: string; raw_value: string | null; status: string }[];
  substances: { wake_date: string; substance: string }[];
};

export function drinkStatus(rows: DrinkRows): DrinkMap {
  const out: DrinkMap = new Map();
  const mark = (day: string, s: DrinkStatus) => {
    if (s === 'wet' || !out.has(day)) out.set(day, s);
  };
  const next = (d: string) => formatDateUTC(parseDateUTC(d) + 86_400_000);
  for (const j of rows.journal) {
    if (j.answered_yes === null || j.answered_yes === undefined) continue;
    mark(j.wake_date, j.answered_yes ? 'wet' : 'dry');
  }
  for (const r of rows.al1) {
    if (r.status !== 'answered' || r.raw_value == null) continue;
    mark(next(r.wake_date), r.raw_value === 'None' ? 'dry' : 'wet');
  }
  for (const s of rows.substances) if (s.substance === 'alcohol') mark(next(s.wake_date), 'wet');
  return out;
}

// A Finding's progress line as a sentence after "Not clear yet.":
// "need 5 dry nights to take drinking out, have 0" -> "Needs 5 dry nights to take drinking out; has 0."
// "12 of 30 effective days" -> "Has 12 of the 30 days of data it needs."
// Anything else ("Not enough variation to tell yet") is capitalised and given a full stop.
export function progressSentence(progress: string): string {
  const gate = /^need (\d+) (.+), have (\d+)$/.exec(progress);
  if (gate) return `Needs ${gate[1]} ${gate[2]}; has ${gate[3]}.`;
  const ess = /^(\d+) of (\d+) effective days$/.exec(progress);
  if (ess) return `Has ${ess[1]} of the ${ess[2]} days of data it needs.`;
  return `${progress.charAt(0).toUpperCase()}${progress.slice(1)}.`;
}

function drinkGates(wets: number[]): { drink: Finding['drink']; gates: Gate[] } {
  const wet = wets.filter((w) => w === 1).length;
  const dry = wets.length - wet;
  return {
    drink: { wet, dry },
    gates: [
      { label: 'drinking nights to take drinking out', have: wet, need: DRINK_NEEDED },
      { label: 'dry nights to take drinking out', have: dry, need: DRINK_NEEDED },
    ],
  };
}

// ─── H2a: best sleep timing (three bands) ──────────────────────────────────
// That night's middle of sleep against your usual (normalAt on the midpoint series,
// the same "usual" the Body clock shows): earlier = at least an hour before it,
// later = at least an hour after, near usual = the rest. Each contrast is the band's
// mean outcome deviation minus the near-usual band's, holding total sleep that
// night, the day before's strain and drinking fixed. Reported on all three outcomes.
export const TIMING_BAND_MIN = 60;

export function timingBand(devMinutes: number): TimingBand {
  if (devMinutes <= -TIMING_BAND_MIN) return 'earlier';
  if (devMinutes >= TIMING_BAND_MIN) return 'later';
  return 'near';
}

const BAND_LABEL: Record<TimingBand, string> = { earlier: 'earlier nights', near: 'near-usual nights', later: 'later nights' };
const CONTRAST_LEAD: Record<TimingContrast, string> = {
  earlier: 'Asleep an hour or more earlier than usual',
  later: 'Asleep an hour or more later than usual',
};

function buildTiming(
  midpoint: Series,
  outcome: Series,
  strain: Series,
  totalSleep: Series,
  drinks: DrinkMap,
  dates: string[],
  spec: OutcomeSpec,
): Finding[] {
  const n = midpoint.length;
  const ys: number[] = [];
  const design: number[][] = [];
  const days: number[] = [];
  const bands: Record<TimingBand, number> = { earlier: 0, near: 0, later: 0 };
  const wets: number[] = [];
  for (let D = 0; D < n; D++) {
    const x = devAt(midpoint, D, true);
    const y = devAt(outcome, D);
    const c1 = devAt(totalSleep, D);
    const c2 = devAt(strain, D - 1);
    const drink = drinks.get(dates[D]);
    if (x === null || y === null || c1 === null || c2 === null || drink === undefined) continue;
    const band = timingBand(x);
    const wet = drink === 'wet' ? 1 : 0;
    bands[band]++;
    wets.push(wet);
    ys.push(y);
    design.push([band === 'earlier' ? 1 : 0, band === 'later' ? 1 : 0, c1, c2, wet]);
    days.push(D);
  }
  const dg = drinkGates(wets);
  return TIMING_CONTRASTS.map((c, coef) =>
    buildFinding({
      id: `H2a-${c}-${spec.key}`,
      question: `Does falling asleep an hour or more ${c} than usual change ${spec.key === 'rhr' ? 'resting heart rate' : spec.key === 'hrv' ? 'HRV' : 'recovery'}?`,
      unit: spec.unit,
      step: `a night asleep an hour or more ${c} than your usual`,
      design,
      coef,
      stepMultiplier: 1,
      arms: { high: bands[c], low: bands.near },
      gates: [
        ...dg.gates,
        ...(['earlier', 'near', 'later'] as TimingBand[]).map((b) => ({ label: BAND_LABEL[b], have: bands[b], need: ARM_NEEDED })),
      ],
      worseWhen: spec.worseWhen,
      headlineFn: (mag, lo, hi, dir) => `${CONTRAST_LEAD[c]}: ${spec.phrase(mag, dir)} (${lo} to ${hi}).`,
      ys,
      days,
      bands: { ...bands },
      drink: dg.drink,
    }),
  );
}

// ─── H2b: is irregular timing harming you ──────────────────────────────────
// Exposure: the Body clock's week figure (weekIrregularityAt: 7-night median
// |midpoint − usual|, min 5 nights) as a deviation from its own 28-day normal,
// like every exposure in this file (CORRELATION_RULES §1). Reported per 30 min
// more irregular than your usual week, on all three outcomes, holding total sleep
// that night, the day before's strain and drinking fixed.
function buildIrregularity(
  irregularity: Series,
  outcome: Series,
  strain: Series,
  totalSleep: Series,
  drinks: DrinkMap,
  dates: string[],
  spec: OutcomeSpec,
): Finding {
  const n = irregularity.length;
  const xs: number[] = [];
  const ys: number[] = [];
  const design: number[][] = [];
  const days: number[] = [];
  const wets: number[] = [];
  for (let D = 0; D < n; D++) {
    const x = devAt(irregularity, D);
    const y = devAt(outcome, D);
    const c1 = devAt(totalSleep, D);
    const c2 = devAt(strain, D - 1);
    const drink = drinks.get(dates[D]);
    if (x === null || y === null || c1 === null || c2 === null || drink === undefined) continue;
    const wet = drink === 'wet' ? 1 : 0;
    xs.push(x);
    wets.push(wet);
    ys.push(y);
    design.push([x, c1, c2, wet]);
    days.push(D);
  }
  const dg = drinkGates(wets);
  const ag = armGates(xs, 15, { high: 'irregular nights', low: 'regular nights' });
  return buildFinding({
    id: `H2b-${spec.key}`,
    question: `Does irregular sleep timing change ${spec.key === 'rhr' ? 'resting heart rate' : spec.key === 'hrv' ? 'HRV' : 'recovery'}?`,
    unit: spec.unit,
    step: 'a week 30 min more irregular than your usual',
    design,
    coef: 0,
    stepMultiplier: 30,
    arms: ag.arms,
    gates: [...dg.gates, ...ag.gates],
    worseWhen: spec.worseWhen,
    headlineFn: (mag, lo, hi, dir) =>
      `A week 30 min more irregular than your usual: ${spec.phrase(mag, dir)} (${lo} to ${hi}).`,
    ys,
    days,
    drink: dg.drink,
  });
}

// Days the tests must not see. Skipped days (travel/sick) lose every measure,
// so they are missing as exposure, as outcome and in the rolling normals. The
// in-progress day (today) keeps its morning recovery but loses steps and strain,
// which are still accumulating. Rest days are not skipped.
export function excludeDays(
  rows: CycleRow[],
  skip: Iterable<string>,
  inProgressDay?: string,
): CycleRow[] {
  const skipSet = new Set(skip);
  return rows.map((r) => {
    if (skipSet.has(r.wake_date)) {
      return {
        wake_date: r.wake_date, recovery_score: null, hrv_rmssd_ms: null, resting_heart_rate: null,
        day_strain: null, sleep_start: null, sleep_end: null, total_sleep_minutes: null,
        deep_sleep_minutes: null, step_count: null,
      };
    }
    if (inProgressDay && r.wake_date === inProgressDay) return { ...r, step_count: null, day_strain: null };
    return r;
  });
}

// Every registered test, in REGISTERED_TESTS order. `drinks` is the known drinking
// status per wake_date (drinkStatus); without it the H2 tests have no known days
// and say so, they never run with the drinking column dropped.
export function runH0(rows: CycleRow[], tz: string, drinks: DrinkMap = new Map()): Finding[] {
  const { dates, byDate } = expandCalendar(rows);
  const strain = seriesOf(dates, byDate, 'day_strain');
  const recovery = seriesOf(dates, byDate, 'recovery_score');
  const totalSleep = seriesOf(dates, byDate, 'total_sleep_minutes');
  const midpoint = midpointSeriesOf(dates, byDate, tz);
  const irregularity: Series = dates.map((_, i) => weekIrregularityAt(midpoint, i).value);
  const outcomeSeries = (o: OutcomeSpec) => seriesOf(dates, byDate, o.field);

  return [
    buildA(
      strain,
      recovery,
      totalSleep,
      1,
      'H0a1',
      "Does a harder-than-usual day lower tomorrow's recovery?",
      'next morning',
    ),
    buildA(
      strain,
      recovery,
      totalSleep,
      2,
      'H0a2',
      "Does a harder-than-usual day lower recovery the morning after next?",
      'the morning after next',
    ),
    buildD(seriesOf(dates, byDate, 'step_count'), recovery, strain, totalSleep),
    ...OUTCOMES.flatMap((o) => buildTiming(midpoint, outcomeSeries(o), strain, totalSleep, drinks, dates, o)),
    ...OUTCOMES.map((o) => buildIrregularity(irregularity, outcomeSeries(o), strain, totalSleep, drinks, dates, o)),
  ];
}

// ─── Testing next: log-based hypotheses (H1) ───────────────────────────────
// Only the counting rule for now: which logged days fall in each arm, and only
// days whose next-morning outcome WHOOP scored. Nothing is estimated or shown
// as an effect until both arms reach ARM_NEEDED and the same gate as H0 runs.
// Kept here so that engine uses exactly these arms.

export const DINNER_SHIFT_MIN = 45;

export type Pending = {
  id: 'H1a' | 'H1b';
  cause: string;
  effect: string;
  arms: { label: string; have: number }[];
  need: number;
};

export function pendingTests(p: {
  cycles: CycleRow[];
  // first dinner entry per day, minutes after noon (see trends.eveningMinutes)
  dinners: { day: string; min: number }[];
  settingsDinnerMin: number | null; // your dinner time from setup, same clock
  drinkDays: Set<string>;           // any alcohol logged
  foodDays: Set<string>;            // any food logged (a dry day is a logged day with no drinks)
}): Pending[] {
  const by = new Map(p.cycles.map((c) => [c.wake_date, c]));
  const next = (d: string) => by.get(formatDateUTC(parseDateUTC(d) + 86400000));
  // Usual dinner: your own median once 7 dinners are logged, the setup time until then.
  const usual = p.dinners.length >= 7 ? median(p.dinners.map((d) => d.min)) : p.settingsDinnerMin;
  const scoredHrv = p.dinners.filter((d) => next(d.day)?.hrv_rmssd_ms != null);
  const late = usual == null ? 0 : scoredHrv.filter((d) => d.min - usual >= DINNER_SHIFT_MIN).length;
  const early = usual == null ? 0 : scoredHrv.filter((d) => usual - d.min >= DINNER_SHIFT_MIN).length;
  const scoredRec = (d: string) => next(d)?.recovery_score != null;
  const wet = [...p.drinkDays].filter(scoredRec).length;
  const dry = [...p.foodDays].filter((d) => !p.drinkDays.has(d) && scoredRec(d)).length;
  return [
    { id: 'H1a', cause: 'Late dinner', effect: 'HRV that night', need: ARM_NEEDED,
      arms: [{ label: 'late', have: late }, { label: 'early', have: early }] },
    { id: 'H1b', cause: 'Drinks', effect: 'next-morning recovery', need: ARM_NEEDED,
      arms: [{ label: 'drinking days', have: wet }, { label: 'dry days', have: dry }] },
  ];
}
