// Guardrails for the meal reader, pure (no I/O), shared by the server and the logger.
//
// The reader (an LLM) is good at reading "2 roti + egg curry" and bad at inventing
// portion grams: it logged one breakfast as 160 g of roti (≈5 rotis) and a 4-egg curry.
// So for everyday staples the model only names the food (a REF key) and the count you
// said; the grams and per-100 g numbers come from the table below. Where you didn't
// say how many / how big, the logger asks with chips set to a modest default.
// Everything the model still estimates goes through guard(): numbers that can't be
// true are pulled down, never up (overestimation compounds through the analysis).
import type { Per100 } from "./food";
import { REF_LIST, REF_ALIASES } from "./foodRefData.ts";

// A choice the logger offers as chips: "1 · 2 · 3 · 4" roti, or "katori · bowl · plate".
export type Pick = { unit: string; opts: { label: string; g: number }[]; i: number; ask: boolean };

export const BOWLS = [
  { label: "katori", g: 150 },
  { label: "bowl", g: 250 },
  { label: "plate", g: 350 },
] as const;
export type BowlSize = (typeof BOWLS)[number]["label"];

type Piece = { kind: "piece"; unit: string; g: number; dflt: number; outG?: number }; // outG: one piece eaten out, when restaurants serve it bigger
type Bowl = { kind: "bowl"; dflt: BowlSize; g?: Partial<Record<BowlSize, number>> }; // g: this food's own weights where the generic bowls run heavy (poha, upma)
export type Ref = {
  key: string; name: string; per100: Per100;
  serve: Piece | Bowl;
  oil100: number; // g of added oil/ghee per 100 g in the table value (0 = none): the oil chips move this
  src: string;    // where the numbers come from; "assumed" in it means an unsourced recipe/size: shown as "typical"
};

// The reader prompt's examples of piece foods that are NOT table rows; a test keeps them off the table
// (momo and pizza slice were examples here until they got rows).
export const OFF_TABLE_PIECES = ["cookie", "biscuit", "piece of cake", "protein bar"];

// The table itself (values, sources, aliases) lives in foodRefData.ts.
export const REFS: Ref[] = REF_LIST;
const byKey = new Map(REFS.map((r) => [r.key, r]));
export const findRef = (key: string | null | undefined): Ref | null => (key ? byKey.get(key) ?? null : null);
// What a row says about its numbers: "food table" only when they're sourced, "typical" when any part is assumed.
export const refLabel = (ref: Ref | null): string => (ref && !/assumed/i.test(ref.src) ? "food table" : "typical");

// Name → ref without the model (the per-100 g estimator). Exact alias match only:
// "chicken biryani" must not become "chicken curry".
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().replace(/s$/, "");
const ALIASES = new Map<string, string>();
for (const r of REFS) for (const n of [r.key, r.name, ...(REF_ALIASES[r.key] ?? [])]) ALIASES.set(norm(n), r.key);
export const refByName = (name: string): Ref | null => findRef(ALIASES.get(norm(name)));

// The chips for a ref'd dish. count: how many pieces they said (0 = not said);
// size: the bowl they said ("" = not said). ask is true when nothing was said.
// out: they ate it out (restaurant, delivery): an unsaid bowl starts at "bowl", not "katori",
// and a piece restaurants serve bigger (dosa) takes its eaten-out weight.
export function pickFor(ref: Ref, count: number, size: string, out = false): Pick {
  if (ref.serve.kind === "piece") return countPick(ref.serve.unit, out ? ref.serve.outG ?? ref.serve.g : ref.serve.g, count, ref.serve.dflt);
  const said = BOWLS.findIndex((b) => b.label === size);
  const dflt = out && ref.serve.dflt === "katori" ? "bowl" : ref.serve.dflt;
  const i = said >= 0 ? said : BOWLS.findIndex((b) => b.label === dflt);
  return { unit: "", opts: BOWLS.map((b) => ({ label: b.label, g: ref.serve.kind === "bowl" ? ref.serve.g?.[b.label] ?? b.g : b.g })), i, ask: said < 0 };
}

// "1 · 2 · 3 · 4" chips of one piece weighing g; count = how many they said (0 = not said), dflt otherwise.
function countPick(unit: string, g: number, count: number, dflt: number): Pick {
  const n = count > 0 ? Math.max(0.5, Math.round(count * 2) / 2) : dflt; // halves allowed ("1.5 dosa")
  const base = [1, 2, 3, 4];
  const nums = base.includes(n) ? base : [...base, n].sort((a, b) => a - b);
  return { unit, opts: nums.map((k) => ({ label: String(k), g: Math.round(k * g) })), i: nums.indexOf(n), ask: !(count > 0) || n > LIMITS.maxCount };
}

// They stated the weight ("200g chicken fry"): a "<n> g" chip joins the others and is selected, not asked.
function withStated(pick: Pick, n: number): Pick {
  const label = `${Math.round(n)} g`;
  const opts = [...pick.opts, { label, g: Math.round(n) }].sort((a, b) => a.g - b.g);
  return { ...pick, opts, i: opts.findIndex((o) => o.label === label), ask: false };
}

// Oil chips on a table dish: low halves the added oil, high doubles it (restaurant cooking runs
// about twice the home recipe). Fat and kcal move with it.
export function withOil(ref: Ref, oil: string): Per100 {
  const d = oil === "low" ? -ref.oil100 / 2 : oil === "high" ? ref.oil100 : 0;
  const p = ref.per100;
  // Oil carries no fibre or sugar; a row without them stays unknown (null), never 0.
  return { ...p, fat_100: r1(p.fat_100 + d), kcal_100: Math.round(p.kcal_100 + 9 * d), fibre_100: p.fibre_100 ?? null, sugar_100: p.sugar_100 ?? null };
}

// ── guard: limits on anything the model estimated (never on label numbers) ──
export const LIMITS = {
  atwaterTol: 0.15,       // kcal must sit within 15% of 4·P + 4·C + 9·F
  maxFibre100: 40,        // the fibre-richest foods (bran, chia, psyllium) sit near it; more is impossible
  maxKcal100: 900,        // pure fat; anything denser is impossible (oil, ghee and nuts sit near it)
  maxProtein100: 32,      // cooked lean meat/fish
  maxProtein100Plain: 15, // anything that isn't meat, fish, egg, paneer, soy or a protein product
  bigPortionG: 400,       // a single estimated dish heavier than this gets the size question
  maxCount: 8,            // a stated table count above this ("20 roti") is more likely a slip: ask
} as const;
const PROTEIN_FOOD = /chicken|mutton|beef|pork|lamb|fish|prawn|shrimp|crab|tuna|salmon|meat|keema|egg|paneer|tofu|soy|whey|protein|chunk|cheese|peanut|almond|cashew|pista|walnut|nut|seed|sattu|chana|dal|lentil|bean/i;

export type Guarded = { per100: Per100; adjusted: boolean };
export function guard(food: string, p: Per100): Guarded {
  let { kcal_100, protein_100, carb_100, fat_100 } = p;
  const cap = PROTEIN_FOOD.test(food) ? LIMITS.maxProtein100 : LIMITS.maxProtein100Plain;
  protein_100 = Math.min(protein_100, cap);
  const sum = protein_100 + carb_100 + fat_100; // grams of macros can't exceed 100 g per 100 g
  if (sum > 100) { const k = 100 / sum; protein_100 *= k; carb_100 *= k; fat_100 *= k; }
  kcal_100 = Math.min(kcal_100, LIMITS.maxKcal100);
  const atw = 4 * protein_100 + 4 * carb_100 + 9 * fat_100;
  if (atw > kcal_100 * (1 + LIMITS.atwaterTol)) {
    // macros say more energy than the kcal: shrink the macros to the kcal (the lower number wins)
    const k = kcal_100 / atw; protein_100 *= k; carb_100 *= k; fat_100 *= k;
  } else if (atw > 0 && kcal_100 > atw * (1 + LIMITS.atwaterTol)) {
    kcal_100 = atw; // kcal says more than the macros can carry: use the macros' energy
  }
  // Fibre and sugar only ever come down: sugar can't exceed the (final) carbs, fibre is capped.
  // Unknown (null/undefined) passes through as null.
  const fibre_100 = p.fibre_100 == null ? null : r1(Math.min(p.fibre_100, LIMITS.maxFibre100));
  const sugar_100 = p.sugar_100 == null ? null : r1(Math.min(p.sugar_100, r1(carb_100)));
  const out = { kcal_100: Math.round(kcal_100), protein_100: r1(protein_100), carb_100: r1(carb_100), fat_100: r1(fat_100), fibre_100, sugar_100 };
  const adjusted = out.kcal_100 !== Math.round(p.kcal_100) || out.protein_100 !== r1(p.protein_100)
    || out.carb_100 !== r1(p.carb_100) || out.fat_100 !== r1(p.fat_100)
    || (p.fibre_100 != null && fibre_100 !== r1(p.fibre_100)) || (p.sugar_100 != null && sugar_100 !== r1(p.sugar_100));
  return { per100: out, adjusted };
}

// ── one recorded dish from the meal reader → what the logger gets ──
// The strict record_dishes tool's shape (lib/mealReader.ts SCHEMA).
export type RawDish = {
  food: string; portion: "small" | "regular" | "large";
  grams_small: number; grams_regular: number; grams_large: number;
  kcal_100: number; protein_100: number; carb_100: number; fat_100: number;
  fibre_100: number | null; sugar_100: number | null; // null = unknown
  cooked: boolean; dose_mg: number; caffeine_100: number;
  source: "estimate" | "label" | "web"; basis: string;
  ref: string; count: number; size: string; drink: boolean; out: boolean;
  grams_said: number; unit: string; unit_g: number; // the weight they stated (0 = none); for a non-table piece food, its piece name and one piece's weight
};
const clamp = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(v) || 0));
// Like clamp, but unknown stays null (never 0).
const clampN = (v: unknown, lo: number, hi: number) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : clamp(v, lo, hi));

// One recorded dish → what the logger gets. A table dish takes its grams and numbers
// from the table; a model estimate goes through guard(); label/web numbers are kept as read.
export function resolveDish(d: RawDish) {
  const source = (["estimate", "label", "web"] as const).includes(d.source) ? d.source : "estimate";
  const base = {
    food: String(d.food).slice(0, 60),
    cooked: !!d.cooked,
    dose_mg: clamp(d.dose_mg, 0, 1000),
    caffeine_100: clamp(d.caffeine_100, 0, 400),
    drink: !!d.drink,
  };
  const said = clamp(d.grams_said, 0, 5000);
  // The model sometimes leaves ref empty for a table food under another name ("kadala curry"): match the name too.
  const ref = source === "estimate" && !base.dose_mg ? findRef(d.ref) ?? refByName(base.food) : null;
  if (ref) {
    // Eaten out: restaurant cooking carries more oil and bigger bowls than the home recipe in the table.
    const out = !!d.out;
    let pick: Pick = pickFor(ref, Number(d.count) || 0, String(d.size ?? ""), out);
    if (said > 0) pick = withStated(pick, said);
    const g = pick.opts[pick.i].g;
    const oil = out && ref.oil100 > 0 ? "high" : "normal";
    return {
      ...base, ref: ref.key, cooked: ref.oil100 > 0, pick, ask: pick.ask, out, oil,
      portion: "regular" as const, grams: { small: g, regular: g, large: g },
      per100: withOil(ref, oil), source: "table" as const, basis: refLabel(ref) + (out ? " · eaten out" : ""),
    };
  }
  const grams = { small: clamp(d.grams_small, 1, 2000), regular: clamp(d.grams_regular, 1, 2000), large: clamp(d.grams_large, 1, 3000) };
  const raw = {
    kcal_100: clamp(d.kcal_100, 0, 900), protein_100: clamp(d.protein_100, 0, 100),
    carb_100: clamp(d.carb_100, 0, 100), fat_100: clamp(d.fat_100, 0, 100),
    fibre_100: clampN(d.fibre_100, 0, 100), sugar_100: clampN(d.sugar_100, 0, 100),
  };
  const portion = (["small", "regular", "large"] as const).includes(d.portion) ? d.portion : "regular";
  if (source !== "estimate") return { ...base, portion, grams, per100: raw, source, basis: String(d.basis ?? "").slice(0, 80) };
  const g = guard(base.food, raw);
  // A big single helping is the likeliest overestimate: ask for the size rather than trust it.
  const ask = !said && !d.drink && grams[portion] > LIMITS.bigPortionG;
  const basis = g.adjusted ? "estimate · adjusted to fit" : String(d.basis || "estimate").slice(0, 80);
  if (said > 0) return { ...base, portion: "regular" as const, grams: { ...grams, regular: Math.round(said) }, per100: g.per100, source, ask: false, basis };
  // A piece food outside the table (cookie, momo, slice): chips of one typical piece, the count asked if unsaid.
  const unit = String(d.unit ?? "").trim().toLowerCase().slice(0, 20), unitG = clamp(d.unit_g, 0, 300);
  if (unit && unitG >= 1) {
    const pick = countPick(unit, Math.round(unitG), Number(d.count) || 0, 1);
    return { ...base, portion, grams, per100: g.per100, source, pick, ask: pick.ask, basis };
  }
  return { ...base, portion, grams, per100: g.per100, source, ask, basis };
}

// ── the one blocking question per meal ──
// A dish that still asks (amount unsaid, untapped) blocks the Log button only when the next
// option up would move the meal a lot: swing = kcal at the next chip up minus kcal now, and it
// must be >= 80 kcal AND >= 20% of the meal's current kcal. Drinks never block. At most one: the
// biggest swing wins. Returns its index, or -1. A dish with no next option has kcalNext = kcalNow.
export const BLOCK = { minKcal: 80, minShare: 0.2 } as const;
export type AskDish = { asking: boolean; isDrink: boolean; kcalNow: number; kcalNext: number };
export function blockingAsk(dishes: AskDish[], mealKcal: number): number {
  let best = -1, bestSwing = 0;
  dishes.forEach((d, i) => {
    const swing = d.kcalNext - d.kcalNow;
    if (!d.asking || d.isDrink || swing < BLOCK.minKcal || swing < BLOCK.minShare * mealKcal) return;
    if (swing > bestSwing) { best = i; bestSwing = swing; }
  });
  return best;
}

// A logged row's basis after its grams were edited: the portion part goes stale ("1 katori · 150 g"),
// so it becomes "<g> g" and keeps the source label ("100 g · food table · edited"). A label's
// per-100 g derivation doesn't mention the portion, so it stays.
export function editedBasis(basis: string | null | undefined, grams: number): string | null {
  if (!basis) return basis ?? null;
  const segs = basis.split(" · ");
  const i = segs.findIndex((x) => /(^|≈ )\d+(\.\d+)? g$/.test(x));
  if (i < 0) return basis;
  return [`${Math.round(grams)} g`, ...segs.slice(i + 1).filter((x) => x !== "edited"), "edited"].join(" · ");
}

const r1 = (v: number) => Math.round(v * 10) / 10;
