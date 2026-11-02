// Canonical exercise library — bundled, public-domain (free-exercise-db, curated
// to the strength family). No API, no key, works offline. Every logged lift maps
// to a stable id here so progression + muscle-group analysis stay honest.
import data from "./exercises.json";

export type TrackingType = "weight_reps" | "bodyweight" | "hold";

export type Exercise = {
  id: string;
  name: string;
  pm: string[]; // primary muscles
  sm: string[]; // secondary muscles
  eq: string | null; // equipment
  mech: string | null; // compound | isolation
  force: string | null; // push | pull | static
  cat: string;
  type: TrackingType;
};

const ALL = data as Exercise[];
const BY_ID = new Map(ALL.map((e) => [e.id, e]));

export function exerciseById(id: string): Exercise | undefined {
  return BY_ID.get(id);
}
export function allExercises(): Exercise[] {
  return ALL;
}

// Muscle groups present, for the filter chips (ordered by how often they're trained).
export const MUSCLES: string[] = (() => {
  const n: Record<string, number> = {};
  for (const e of ALL) e.pm.forEach((m) => (n[m] = (n[m] || 0) + 1));
  return Object.keys(n).sort((a, b) => n[b] - n[a]);
})();

// Equipment commonness — so a search for "bench press" surfaces the barbell /
// dumbbell staple, not "Bench Press with Chains" or "Smith Machine Bench Press".
const EQ_RANK: Record<string, number> = {
  barbell: 0, dumbbell: 1, "body only": 2, machine: 3, cable: 3,
  kettlebells: 4, "e-z curl bar": 4, other: 5, "": 5,
  bands: 6, "medicine ball": 6, "exercise ball": 6, "foam roll": 7,
};
// Specialty qualifiers that should sink beneath the plain movement.
const SPECIALTY = /\b(chains?|bands?|smith|reverse|partials?|paused?|deficit|tempo|guillotine|cambered)\b/i;

// The plain, canonical movements — boosted so "squat" surfaces "Barbell Squat",
// not "Box Squat". (The everyday staples; the rest of the 675 stay searchable.)
const CANONICAL = new Set([
  "Barbell_Squat", "Front_Barbell_Squat", "Barbell_Deadlift", "Romanian_Deadlift",
  "Barbell_Bench_Press_-_Medium_Grip", "Barbell_Incline_Bench_Press_-_Medium_Grip",
  "Standing_Military_Press", "Barbell_Shoulder_Press", "Bent_Over_Barbell_Row",
  "Barbell_Curl", "Pullups", "Chin-Up", "Dips_-_Triceps_Version", "Pushups",
  "Barbell_Lunge", "Barbell_Hip_Thrust", "Wide-Grip_Lat_Pulldown", "Leg_Press",
  "Dumbbell_Bench_Press", "Dumbbell_Shoulder_Press", "Hammer_Curls", "Dumbbell_Lunges",
  "Leg_Extensions", "Seated_Leg_Curl", "Standing_Calf_Raises", "Hanging_Leg_Raise",
  "Plank", "Face_Pull", "Triceps_Pushdown", "Dumbbell_Bicep_Curl",
  "Barbell_Shrug", "Side_Lateral_Raise", "Seated_Cable_Rows",
]);

// Gym shorthand → canonical words, applied to the query before matching so "rdl",
// "ohp", "db bench" and "farmer's walk" all resolve. Word-boundaried, order-applied.
const ALIASES: [RegExp, string][] = [
  [/\brdl\b/g, "romanian deadlift"], [/\bsldl\b/g, "stiff leg deadlift"],
  [/\bohp\b/g, "shoulder press"], [/\boverhead press\b/g, "shoulder press"],
  [/\bpec deck\b/g, "butterfly"], [/\bfarmers? (walk|carry)\b/g, "farmer walk"],
  [/\btbar\b/g, "t bar"], [/\bdb\b/g, "dumbbell"], [/\bbb\b/g, "barbell"],
  [/\babs\b/g, "abdominals"], [/\bcore\b/g, "abdominals"], [/\bbw\b/g, "bodyweight"],
  [/\bbicep\b/g, "biceps"], [/\btricep\b/g, "triceps"], [/\bquads?\b/g, "quadriceps"],
  [/\bhams?\b/g, "hamstrings"], [/\bglute\b/g, "glutes"], [/\bcalf\b/g, "calves"],
  [/\bdelts?\b/g, "shoulders"], [/\blat\b/g, "lats"], [/\bpecs?\b/g, "chest"],
];

// Normalize so apostrophes / hyphens don't block a match ("Farmer's Walk" ← "farmers").
function norm(s: string): string {
  return s.toLowerCase().replace(/['’]/g, "").replace(/[-/]/g, " ").replace(/\s+/g, " ").trim();
}

// Token-AND over name + muscles + equipment. Ranked: canonical staple > phrase-at-
// word-boundary > plain-over-specialty > common-equipment > shorter name.
export function searchExercises(
  q: string,
  opts: { muscle?: string | null; limit?: number } = {}
): Exercise[] {
  const { muscle = null, limit = 50 } = opts;
  let pool = ALL;
  if (muscle) pool = pool.filter((e) => e.pm.includes(muscle) || e.sm.includes(muscle));
  if (!q.trim()) return pool.slice(0, limit);
  let phrase = norm(q);
  for (const [re, rep] of ALIASES) phrase = phrase.replace(re, rep);
  const toks = [...new Set(phrase.split(" ").filter(Boolean))];
  const scored: [number, number, number, number, number, Exercise][] = [];
  for (const e of pool) {
    const name = norm(e.name);
    const hay = norm(`${e.name} ${e.pm.join(" ")} ${e.sm.join(" ")} ${e.eq ?? ""}`);
    if (!toks.every((t) => hay.includes(t))) continue;
    let ph = 2; // tokens present, non-contiguous
    if (name === phrase) ph = 0; // exact name
    else if (name.startsWith(phrase) || name.includes(` ${phrase}`)) ph = 1; // contiguous at a word boundary
    const canon = CANONICAL.has(e.id) ? 0 : 1;
    const specialty = SPECIALTY.test(e.name) ? 1 : 0;
    const eqr = EQ_RANK[e.eq ?? ""] ?? 5;
    scored.push([canon, ph, specialty, eqr, shortName(e.name).length, e]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4]);
  return scored.slice(0, limit).map((x) => x[5]);
}

// free-exercise-db names carry a grip qualifier ("- Medium Grip"); trim it for
// list density, keep the rest verbatim so nothing is silently merged.
export function shortName(name: string): string {
  return name.replace(/\s*-\s*(medium|wide|narrow|close|standard)\s+grip\s*$/i, "");
}
