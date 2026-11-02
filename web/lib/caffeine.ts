// Caffeine in a logged food or drink, in mg. Pure (no Supabase), so it is testable.
// The meal reader gives mg per 100 g when it can; otherwise a typical figure by name.
// Figures are the reader's own references and err low (overestimates compound downstream).

// mg per 100 g (≈ ml) as served. First match wins, so specific names come before general ones.
const BY_NAME: [RegExp, number][] = [
  [/\b(espresso|ristretto|lungo|doppio)\b/i, 210],
  [/\b(latte|cappuccino|flat white|cortado|macchiato|mocha|frapp(e|uccino)|affogato)\b/i, 25],
  [/\b(coffee|americano|cold brew|kaapi)\b/i, 40],
  [/\b(red bull|monster|sting|energy drink)\b/i, 32],
  [/\bic(e|ed) tea\b/i, 5],
  [/\bgreen tea\b/i, 12],
  [/\b(chai|tea|matcha)\b/i, 20],
  [/\b(cola|coke|pepsi|thums up)\b/i, 10],
];
// Decaf and herbal drinks have none; coffee-flavoured food isn't a coffee.
const NONE = /\b(decaf\w*|caffeine[- ]free|herbal|chamomile|peppermint|rooibos|cake|cookies?|biscuits?|brownies?|ice cream|gelato|sandwich|martini|chocolate|steak|tiramisu)\b/i;

export function caffeinePer100(food: string): number {
  if (NONE.test(food)) return 0;
  return BY_NAME.find(([re]) => re.test(food))?.[1] ?? 0;
}

// mg to log for a dish, or 0 for none. A reader figure under 30 mg is a trace (food,
// not a drink) unless the name says it's a caffeinated drink, like a small chai.
export function caffeineMg(food: string, grams: number, readerPer100?: number | null): number {
  const byName = caffeinePer100(food);
  const per = readerPer100 ?? byName;
  const mg = Math.min(2000, Math.round((per * grams) / 100)); // the column's own ceiling
  if (mg <= 0) return 0;
  return mg >= 30 || byName > 0 ? mg : 0;
}

// The Drinks unit: about 100 mg is one cup, never less than one.
export const cupsFor = (mg: number) => Math.max(1, Math.round(mg / 100));

// A caffeine pill or tablet is a dose, not food: it skips food_log and goes to
// Supplements in mg. The meal reader flags doses itself (dose_mg); this name check
// covers typed and recent items, and finds pills when adding up the day.
export function isCaffeinePill(food: string): boolean {
  return /\bcaffeine\b/i.test(food) && !/\b(caffeine[- ]free|decaf)\b/i.test(food);
}

type CaffeineDrink = { substance: string; caffeine_mg: number | null; amount: number | null };
type CaffeinePill = { supplement_name: string; dose_amount: number | null; dose_unit: string | null; nutrients?: { key: string; amount: number; unit: string }[] | null };
const TO_MG: Record<string, number> = { mg: 1, g: 1000, mcg: 0.001 };
// A supplement's caffeine in mg: a caffeine product taken in mg is its dose; anything else
// (2 pieces of gum, a pre-workout scoop) is what its brand's label says. null = not known.
function suppCaffeine(s: CaffeinePill): number | null {
  if (isCaffeinePill(s.supplement_name) && s.dose_amount != null && s.dose_unit?.toLowerCase() === "mg") return s.dose_amount;
  const c = (s.nutrients ?? []).filter((n) => n.key === "caffeine" && n.unit in TO_MG);
  return c.length ? c.reduce((t, n) => t + n.amount * TO_MG[n.unit], 0) : null;
}
// "Caffeine today: about 300 mg": drinks plus caffeine from Supplements
// (+ plain cup taps and caffeine products with no amount, which are named, not guessed).
export function caffeineTotal(drinks: CaffeineDrink[], pills: CaffeinePill[]): string | null {
  const c = drinks.filter((s) => s.substance === "caffeine");
  const p = pills.map((s) => ({ s, mg: suppCaffeine(s) }));
  const mg = c.reduce((t, s) => t + (s.caffeine_mg ?? 0), 0) + p.reduce((t, x) => t + (x.mg ?? 0), 0);
  const cups = c.filter((s) => s.caffeine_mg == null).reduce((t, s) => t + (s.amount ?? 1), 0);
  const unsized = p.filter((x) => x.mg == null && isCaffeinePill(x.s.supplement_name)).length;
  if (!mg) return null;
  const extra = [cups && `${cups} cup${cups === 1 ? "" : "s"}`, unsized && `${unsized} pill${unsized === 1 ? "" : "s"}`].filter(Boolean).join(" + ");
  return `Caffeine today: about ${Math.round(mg)} mg${extra ? ` + ${extra} not sized` : ""}`;
}
