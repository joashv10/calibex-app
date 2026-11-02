import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strengthLoad, e1rmRefFrom } from '../lib/loadMath.ts';
import type { LiftEntry } from '../lib/train.ts';

const entry = (id: string, tracking_type: LiftEntry['tracking_type'], sets: [number | null, number][]) =>
  ({ entry_id: id, exercise_id: id, exercise_name: id, tracking_type,
     sets: sets.map(([weight, reps]) => ({ weight, reps, duration_sec: null })) }) as LiftEntry;

test('a 300-rep bodyweight set scores as low intensity, not 71% to failure', () => {
  const push = entry('pushups', 'bodyweight', [[0, 300]]);
  const load = strengthLoad([push], e1rmRefFrom([push]), 62.5);
  const effW = 0.65 * 62.5;
  assert.ok(load < 30 * effW + 1, `load ${load} should stay under 30 × effW`);
  assert.ok(load > 1000 && load < 1200, `expected ≈1,100, got ${load}`);
});

// The pre-fix formula, verbatim, to prove sets of ≤12 reps are untouched.
const est1rm = (w: number | null, r: number | null) => (!w || !r ? null : Math.round(w * (1 + Math.min(r, 12) / 30)));
function oldLoad(entries: LiftEntry[], ref: Map<string, number>, bw: number | null): number {
  let total = 0;
  for (const e of entries) for (const s of e.sets) {
    let effW: number | null = null, reps: number | null = null;
    if (e.tracking_type === 'weight_reps') { effW = s.weight; reps = s.reps; }
    else if (e.tracking_type === 'bodyweight') { if (bw == null) continue; effW = 0.65 * bw + (s.weight ?? 0); reps = s.reps; }
    else if (e.tracking_type === 'hold') { if (bw == null || !s.duration_sec) continue; effW = 0.65 * bw + (s.weight ?? 0); reps = s.duration_sec / 3; }
    if (!effW || !reps || reps <= 0) continue;
    const r = Math.max(ref.get(e.exercise_id) ?? 0, est1rm(effW, Math.min(Math.round(reps), 12)) ?? 0);
    if (!r) continue;
    const est = Math.max(0, 30 * (r / effW - 1) - reps);
    total += reps * effW * Math.min(1, effW / r) * Math.exp(-0.3 * Math.min(est, 10));
  }
  return Math.round(total);
}

test('sets of 12 reps or fewer (weighted, bodyweight, holds ≤36 s) score exactly as before the fix', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2000; i++) {
    const kind = (['weight_reps', 'bodyweight', 'hold'] as const)[i % 3];
    const w = kind === 'weight_reps' ? Math.round(rnd() * 1200) / 10 + 1 : Math.round(rnd() * 200) / 10;
    const e = kind === 'hold'
      ? ({ entry_id: 'h', exercise_id: 'h', exercise_name: 'h', tracking_type: 'hold', sets: [{ weight: w, reps: null, duration_sec: 1 + Math.floor(rnd() * 36) }] } as LiftEntry)
      : entry('e', kind, [[w, 1 + Math.floor(rnd() * 12)]]);
    const ref = new Map(rnd() < 0.5 ? [] : [[e.exercise_id, Math.round(rnd() * 300) + 1]]);
    assert.equal(strengthLoad([e], ref, 62.5), oldLoad([e], ref, 62.5), JSON.stringify(e.sets));
  }
});

test('per-set load never exceeds that set’s weight × reps', () => {
  for (const [w, r] of [[13, 15], [11, 24], [20, 12], [60, 50]] as [number, number][]) {
    const e = entry(`x${w}-${r}`, 'weight_reps', [[w, r]]);
    assert.ok(strengthLoad([e], e1rmRefFrom([e]), null) <= w * r);
  }
});

test('one long set does not raise the reference for normal sets', () => {
  const long = entry('pushups', 'bodyweight', [[0, 300]]);
  assert.equal(e1rmRefFrom([long]).get('pushups'), undefined);
});
