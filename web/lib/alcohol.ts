// Alcohol: what you drank, how much, over what window. Pure, so the tests can run it.
// One entry per drink type per evening. Grams of alcohol are worked out once, at save,
// and stored: changing a default ABV here never rewrites a past night.

export type DrinkType = "beer" | "strong_beer" | "wine" | "whisky" | "vodka" | "rum" | "gin" | "cocktail" | "other";

// carb100: g of carbohydrate per 100 ml, on the low side (dry wine, plain spirits).
type Spec = { label: string; unit: string; units: string; ml: number; sizes?: number[]; abv: number; carb100: number };

// India: spirits are bottled at 42.8%, a peg is 30 ml (a large is two). Strong beer is ~8%.
export const DRINKS: Record<DrinkType, Spec> = {
  beer:        { label: "Beer",        unit: "bottle", units: "bottles", ml: 330, sizes: [330, 500, 650], abv: 5, carb100: 3.5 },
  strong_beer: { label: "Strong beer", unit: "bottle", units: "bottles", ml: 650, sizes: [330, 500, 650], abv: 8, carb100: 4 },
  wine:        { label: "Wine",        unit: "glass",  units: "glasses", ml: 150, abv: 12, carb100: 2.5 },
  whisky:      { label: "Whisky",      unit: "peg",    units: "pegs",    ml: 30,  abv: 42.8, carb100: 0 },
  vodka:       { label: "Vodka",       unit: "peg",    units: "pegs",    ml: 30,  abv: 42.8, carb100: 0 },
  rum:         { label: "Rum",         unit: "peg",    units: "pegs",    ml: 30,  abv: 42.8, carb100: 0 },
  gin:         { label: "Gin",         unit: "peg",    units: "pegs",    ml: 30,  abv: 42.8, carb100: 0 },
  // a mixed drink is about 1½ pegs of spirit in ~200 ml
  cocktail:    { label: "Cocktail",    unit: "drink",  units: "drinks",  ml: 200, abv: 10, carb100: 8 },
  other:       { label: "Other",       unit: "peg",    units: "pegs",    ml: 30,  abv: 40, carb100: 0 },
};
export const DRINK_TYPES = Object.keys(DRINKS) as DrinkType[];
export const isDrinkType = (t: string | null | undefined): t is DrinkType => !!t && t in DRINKS;

const ETHANOL = 0.789; // g per ml
export const STD_DRINK_G = 10; // WHO standard drink: one 30 ml peg of 42.8% ≈ 10 g

export const alcoholG = (volumeMl: number, abv: number) => Math.round(volumeMl * (abv / 100) * ETHANOL * 10) / 10;
export const stdDrinks = (g: number) => g / STD_DRINK_G;

// The old 3-way bucket, still written so the readout, nudges and older rows read the same.
export function bucketOf(g: number): "1-2" | "3-4" | "5+" {
  const n = stdDrinks(g);
  return n < 2.5 ? "1-2" : n < 4.5 ? "3-4" : "5+";
}

// "3 pegs", "1 bottle · 650 ml", "2 glasses"
export function amountLabel(type: DrinkType, count: number, sizeMl: number): string {
  const s = DRINKS[type];
  const n = Number.isInteger(count) ? String(count) : count.toFixed(1);
  const word = count === 1 ? s.unit : s.units;
  return s.sizes ? `${n} ${word} · ${sizeMl} ml` : `${n} ${word}`;
}

// "≈3 drinks" — one decimal under 3 so a single beer doesn't read as 1.
export function drinksLabel(g: number): string {
  const n = stdDrinks(g);
  const r = n < 3 ? Math.round(n * 10) / 10 : Math.round(n);
  return `≈${r} drink${r === 1 ? "" : "s"}`;
}

// One night's drinks as one phrase. Detailed rows sum their grams ("≈5 drinks"); a night
// with any old bucket-only row falls back to the buckets ("3–4 drinks + 5+ drinks").
export function nightLabel(rows: { dose_bucket: string; alcohol_g?: number | null }[]): string | null {
  if (!rows.length) return null;
  if (rows.every((r) => r.alcohol_g != null)) return drinksLabel(rows.reduce((t, r) => t + Number(r.alcohol_g), 0));
  return rows.map((r) => `${r.dose_bucket.replace("-", "–")} drink${r.dose_bucket === "1" ? "" : "s"}`).join(" + ");
}

// A window must not end before it starts. Past midnight is fine: the times are already
// on the right days (atTime rolls anything before 4 AM to the next morning).
export function windowError(start: Date, end: Date | null): string | null {
  if (!end) return null;
  if (end.getTime() < start.getTime()) return "That ends before it starts.";
  if (end.getTime() - start.getTime() > 14 * 3600_000) return "That's over 14 hours. Check the times.";
  return null;
}

// ── calories: 7 kcal per g of alcohol + 4 per g of sugar. Computed, never stored, so a
// row from before carb_g existed still counts its alcohol.
export type AbvSource = "default" | "lookup" | "user";
export const isAbvSource = (s: string | null | undefined): s is AbvSource => s === "default" || s === "lookup" || s === "user";
export const carbG = (volumeMl: number, carb100: number) => Math.round((volumeMl * carb100) / 100 * 10) / 10;
export const drinkKcal = (alcoholG: number | null, carbG: number | null) => Math.round(7 * (alcoholG ?? 0) + 4 * (carbG ?? 0));

const normBrand = (s: string) => s.toLowerCase().replace(/[^a-z0-9% ]/g, " ").replace(/\s+/g, " ").trim();

// A brand's % and sugar from an earlier night. Only rows whose % was looked up or typed:
// an old row carrying the type's default (Fireball saved as 42.8) must never teach it.
export function knownBrand(
  rows: { brand: string | null; abv: number | null; abv_source?: string | null; carb_g?: number | null; volume_ml: number | null; amount?: number | null; drink_type?: string | null }[],
  brand: string,
): { abv: number; carb100: number | null; serveMl: number | null } | null {
  const b = normBrand(brand);
  if (!b) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.brand && normBrand(r.brand) === b && r.abv != null && (r.abv_source === "lookup" || r.abv_source === "user")) {
      const carb100 = r.carb_g != null && r.volume_ml ? Math.round((r.carb_g / r.volume_ml) * 1000) / 10 : null;
      // a cocktail remembers its one-drink size too
      const serveMl = r.drink_type === "cocktail" && r.volume_ml && r.amount ? Math.round(Number(r.volume_ml) / Number(r.amount)) : null;
      return { abv: Number(r.abv), carb100, serveMl };
    }
  }
  return null;
}
