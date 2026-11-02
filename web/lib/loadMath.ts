// Strength-load maths, kept pure (no Supabase import) so node tests can load it.
// Re-exported from lib/load.
import type { LiftEntry } from "./train";

const RIR_DECAY = 0.3; // effort = e^(−0.3·RIR): failure=1.0, 2RIR≈0.55, 4RIR≈0.30
const BW_FRACTION = 0.65; // ~fraction of bodyweight moved in pull-ups/dips/push-ups (lit. 59–65%)
const HOLD_SECS_PER_REP = 3; // time-under-tension convention: ~3s ≈ 1 rep-equivalent

// Same as est1rm in lib/train (Epley, reps capped at 12); duplicated so this file stays pure.
const est1rm = (weight: number | null, reps: number | null): number | null =>
  !weight || !reps ? null : Math.round(weight * (1 + Math.min(reps, 12) / 30));

// ── strength channel: weighted volume load from set logs ───────────────────
// e1RM reference per exercise = best Epley e1RM seen in the window (incl. today)
// → self-calibrating from the very first session.
export function strengthLoad(entries: LiftEntry[], e1rmRef: Map<string, number>, bodyweightKg: number | null): number {
  let total = 0;
  for (const e of entries) {
    for (const s of e.sets) {
      let effW: number | null = null;
      let reps: number | null = null;
      if (e.tracking_type === "weight_reps") { effW = s.weight; reps = s.reps; }
      else if (e.tracking_type === "bodyweight") {
        if (bodyweightKg == null) continue; // no weigh-in yet → honestly excluded
        effW = BW_FRACTION * bodyweightKg + (s.weight ?? 0);
        reps = s.reps;
      } else if (e.tracking_type === "hold") {
        if (bodyweightKg == null || !s.duration_sec) continue;
        effW = BW_FRACTION * bodyweightKg + (s.weight ?? 0);
        reps = s.duration_sec / HOLD_SECS_PER_REP;
      }
      if (!effW || !reps || reps <= 0) continue;
      // The set's own reference: est1rm as before up to 12 reps, uncapped Epley above. est1rm stops at 12 (right for e1RM
      // display), which would score every long set as 71% to failure (300 push-ups ≈ 8,700).
      // Uncapped, a set's load tops out near 30 × its weight. Kept local to the set: it never
      // feeds the window map, or one long set would make normal sets look easy for 28 days.
      const self = reps <= 12 ? est1rm(effW, Math.round(reps)) ?? 0 : effW * (1 + reps / 30);
      const ref = Math.max(e1rmRef.get(e.exercise_id) ?? 0, self);
      if (!ref) continue;
      const relInt = Math.min(1, effW / ref);
      const predMaxReps = 30 * (ref / effW - 1);
      const estRIR = Math.max(0, predMaxReps - reps);
      total += reps * effW * relInt * Math.exp(-RIR_DECAY * Math.min(estRIR, 10));
    }
  }
  return Math.round(total);
}

// Build the e1RM reference map from a window of entries.
export function e1rmRefFrom(entries: LiftEntry[]): Map<string, number> {
  const ref = new Map<string, number>();
  for (const e of entries) {
    for (const s of e.sets) {
      const v = est1rm(s.weight, s.reps);
      if (v != null && v > (ref.get(e.exercise_id) ?? 0)) ref.set(e.exercise_id, v);
    }
  }
  return ref;
}
