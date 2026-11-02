"use client";
import { cupsFor } from "./caffeine";
import { editedBasis, type Pick } from "./foodRef";
import { supabase } from "./supabaseClient";
import * as alc from "./alcohol";
import { logDate, isBackfill } from "./day";
import { sugarFor } from "./fibreSugar.ts";
import { scaleNutrients, siteOf, type Nutrient } from "./supplements.ts";

// The AI routes only answer a signed-in session.
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) };
}

// carb = AVAILABLE carbohydrate (fibre excluded); sugar = total sugars; fibre = total dietary fibre.
// fibre/sugar are null (or absent on old rows) when unknown: never 0.
export type Per100 = { kcal_100: number; protein_100: number; carb_100: number; fat_100: number; fibre_100?: number | null; sugar_100?: number | null };
export type Food = Per100 & { name: string; brand?: string | null; source: string };
export type LogItem = {
  id: string; wake_date: string; slot: string | null; food: string; brand: string | null; grams: number;
  kcal: number | null; protein_g: number | null; carb_g: number | null; fat_g: number | null;
  fibre_g: number | null; sugar_g: number | null;
  oiliness: string | null; eaten_at: string; basis?: string | null;
};
// A saved meal stores each dish's macros inline, so re-logging is self-contained
// (no fragile lookup against the foods library) and carries its own slot/type.
export type MealItem = { food: string; brand: string | null; grams: number; oiliness: string | null; per100: Per100 | null };
export type Meal = { id: string; name: string; slot: string | null; items: MealItem[] };
export type Macros = { kcal: number; protein_g: number; carb_g: number; fat_g: number; fibre_g: number | null; sugar_g: number | null };

export const SLOTS = ["breakfast", "lunch", "afternoon", "dinner", "snack"] as const;

// Fibre and sugar are small numbers: keep one decimal (whole grams would turn 0.4 into 0). Unknown stays null.
const scale1 = (v: number | null | undefined, k: number) => (v == null ? null : Math.round(v * k * 10) / 10);

export function scale(p: Per100, grams: number): Macros {
  const k = grams / 100;
  const carb_g = Math.round(p.carb_100 * k);
  const sugar_g = scale1(p.sugar_100, k);
  return {
    kcal: Math.round(p.kcal_100 * k),
    protein_g: Math.round(p.protein_100 * k),
    carb_g,
    fat_g: Math.round(p.fat_100 * k),
    fibre_g: scale1(p.fibre_100, k),
    sugar_g: sugarFor(sugar_g, carb_g),
  };
}

export async function getFoods(): Promise<Food[]> {
  const { data } = await supabase.from("foods").select("*").order("name");
  return (data as Food[]) ?? [];
}

export async function getTodayLog(): Promise<LogItem[]> {
  const { data } = await supabase.from("food_log").select("*").eq("wake_date", logDate()).order("eaten_at");
  return (data as LogItem[]) ?? [];
}

export async function getMeals(): Promise<Meal[]> {
  const { data } = await supabase.from("saved_meals").select("id,name,slot,items").order("created_at", { ascending: false });
  return (data as Meal[]) ?? [];
}

// Ask CALIBEX (Claude) for per-100g macros. "unconfigured" = no API key yet → manual entry.
export async function estimatePer100(food: string, brand: string, oiliness: string): Promise<Per100 | "unconfigured" | null> {
  try {
    const res = await fetch("/api/estimate", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ food, brand, oiliness }),
    });
    if (res.status === 503) return "unconfigured";
    if (!res.ok) return null;
    return (await res.json()) as Per100;
  } catch { return null; }
}

// "penne alfredo, 1 plate + a coke" → dishes with portions and per-100 g macros.
export type Portion = "small" | "regular" | "large";
// dose_mg > 0 marks a caffeine dose (pill, gum, shot); caffeine_100 is mg per 100 g of a food or drink.
// source: where the numbers came from: a label (photo or stated), a web search, the fixed
// food table (lib/foodRef.ts), or Claude's estimate.
// basis: how a label's numbers were turned into these, e.g. "label per 100 g × 260 g serving".
// pick: a table dish's chips ("1 · 2 · 3 · 4" roti, "katori · bowl · plate"); ask: you didn't
// say how many / how much, so the logger highlights the chips.
export type NumbersFrom = "estimate" | "label" | "web" | "table";
export type ParsedDish = {
  food: string; portion: Portion; grams: Record<Portion, number>; per100: Per100; cooked: boolean;
  dose_mg?: number; caffeine_100?: number; source?: NumbersFrom; basis?: string;
  ref?: string; pick?: Pick; ask?: boolean; out?: boolean; oil?: string; drink?: boolean;
};
export type Photo = { data: string; media_type: "image/jpeg" };
// A screenshot or label photo, shrunk to fit 1600 px as JPEG: enough to read small
// print, small enough to upload fast. Never stored, only read.
export async function photoFromFile(file: File): Promise<Photo> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return { data: c.toDataURL("image/jpeg", 0.85).split(",")[1], media_type: "image/jpeg" };
}
export async function parseMeal(text: string, image?: Photo): Promise<ParsedDish[] | "unconfigured" | null> {
  try {
    const res = await fetch("/api/parse-meal", {
      method: "POST", headers: await authHeaders(), body: JSON.stringify({ text, image }),
    });
    if (res.status === 503) return "unconfigured";
    if (!res.ok) return null;
    return ((await res.json()) as { dishes: ParsedDish[] }).dishes;
  } catch { return null; }
}

// Your recent distinct foods with their last portion and macros: one-tap re-log.
// Every recent log row (newest first) with its meal; MealLogger narrows them to the
// meal being logged via slotPicks.
export type RecentFood = { food: string; brand: string | null; grams: number; oiliness: string | null; per100: Per100 | null; slot: string | null };
export async function getRecentFoods(limit = 400): Promise<RecentFood[]> {
  const { data } = await supabase.from("food_log").select("food,brand,grams,oiliness,kcal,protein_g,carb_g,fat_g,fibre_g,sugar_g,slot")
    .order("eaten_at", { ascending: false }).limit(limit);
  const out: RecentFood[] = [];
  for (const r of (data ?? []) as (LogItem & { grams: number; slot: string | null })[]) {
    if (!r.grams || r.brand === SUPP_BRAND) continue; // protein powder re-logs from Supplements
    const f = 100 / r.grams;
    out.push({
      food: r.food, brand: r.brand, grams: r.grams, oiliness: r.oiliness, slot: r.slot,
      per100: r.kcal == null ? null : {
        kcal_100: Math.round(r.kcal * f), protein_100: +((r.protein_g ?? 0) * f).toFixed(1),
        carb_100: +((r.carb_g ?? 0) * f).toFixed(1), fat_100: +((r.fat_g ?? 0) * f).toFixed(1),
        fibre_100: r.fibre_g == null ? null : +(r.fibre_g * f).toFixed(1), sugar_100: r.sugar_g == null ? null : +(r.sugar_g * f).toFixed(1),
      },
    });
  }
  return out;
}

export async function upsertFood(f: Food) {
  await supabase.from("foods").upsert({ ...f, updated_at: new Date().toISOString() }, { onConflict: "name" });
}

// basis: where the numbers came from ("2 roti · food table", "AI estimate"); input: what you typed, kept for audit.
export async function logFood(item: { slot: string | null; food: string; brand?: string | null; grams: number; oiliness?: string | null; eatenAt?: string; basis?: string | null; input?: string | null } & Partial<Macros>) {
  await supabase.from("food_log").insert({
    wake_date: logDate(), slot: item.slot, food: item.food, brand: item.brand ?? null, grams: item.grams,
    kcal: item.kcal ?? null, protein_g: item.protein_g ?? null, carb_g: item.carb_g ?? null, fat_g: item.fat_g ?? null,
    fibre_g: item.fibre_g ?? null, sugar_g: item.sugar_g ?? null,
    oiliness: item.oiliness ?? null, eaten_at: item.eatenAt ?? new Date().toISOString(),
    ...(item.basis ? { basis: item.basis } : {}), ...(item.input ? { input_text: item.input } : {}),
  });
  if (item.slot) await unskipMeal(item.slot); // eating it contradicts "skipped"
}

export async function deleteLogItem(id: string) {
  await supabase.from("food_log").delete().eq("id", id);
}
// Edit a logged dish: new grams rescale its macros (the per-gram numbers stay as logged).
export async function updateLogItem(i: LogItem, grams: number, eatenAt: string) {
  const basis = grams !== i.grams ? editedBasis(i.basis, grams) : i.basis; // the old "1 katori · 150 g" would lie
  const k = i.grams > 0 ? grams / i.grams : 1;
  const sc = (v: number | null) => (v == null ? null : Math.round(v * k));
  const { error } = await supabase.from("food_log").update({
    grams, eaten_at: eatenAt, ...(basis !== i.basis ? { basis } : {}), kcal: sc(i.kcal), protein_g: sc(i.protein_g), carb_g: sc(i.carb_g), fat_g: sc(i.fat_g),
    fibre_g: scale1(i.fibre_g, k), sugar_g: sugarFor(scale1(i.sugar_g, k), sc(i.carb_g)),
  }).eq("id", i.id);
  if (error) throw error;
}

// ── meal skips: "didn't eat" is data, not a gap ─────────────────────────────
// Each meal is eaten (food_log rows), skipped (a meal_skips row) or unknown
// (neither). Logging food for a slot clears its skip, so the two never disagree.
export const MEAL_SLOTS = ["breakfast", "lunch", "afternoon", "dinner"] as const;

export async function getSkips(): Promise<Set<string>> {
  const { data } = await supabase.from("meal_skips").select("slot").eq("wake_date", logDate());
  return new Set(((data ?? []) as { slot: string }[]).map((r) => r.slot));
}
export async function skipMeal(slot: string) {
  const { error } = await supabase.from("meal_skips")
    .upsert({ wake_date: logDate(), slot }, { onConflict: "wake_date,slot", ignoreDuplicates: true });
  if (error) throw error;
}
export async function unskipMeal(slot: string) {
  await supabase.from("meal_skips").delete().eq("wake_date", logDate()).eq("slot", slot);
}

// Caffeine pills live in Supplements (mg). Caffeine analysis must add these to substance_log (not wired yet).
export { isCaffeinePill } from "./caffeine";
// "caffeine pill 200mg" → "Caffeine pill": the dose lives in its own column.
export const pillName = (food: string) => {
  const n = food.replace(/\s*\d+(\.\d+)?\s*mg\b/gi, "").trim() || "Caffeine pill";
  return n.charAt(0).toUpperCase() + n.slice(1);
};

export async function saveMeal(name: string, slot: string | null, items: MealItem[]) {
  const { error } = await supabase.from("saved_meals").insert({ name, slot, items });
  if (error) throw error;
}
export async function deleteMeal(id: string) {
  await supabase.from("saved_meals").delete().eq("id", id);
}

// ── substances: alcohol / caffeine (dose buckets; timing matters) ──────────
export type Substance = {
  id: number; substance: "alcohol" | "caffeine"; dose_bucket: string; amount: number | null; consumed_at: string;
  // alcohol only (null on older rows): what, how much, until when
  ended_at: string | null; drink_type: string | null; brand: string | null; volume_ml: number | null; abv: number | null; alcohol_g: number | null;
  carb_g: number | null; abv_source: string | null; // null on rows from before 014
  // caffeine only (null on a plain "1 cup" tap and on rows from before 021)
  caffeine_mg: number | null; drink_name: string | null;
};
// One drink type over one window. amount = how many units (pegs, bottles, glasses).
export type AlcoholEntry = {
  drink_type: string; brand: string | null; amount: number; volume_ml: number; abv: number;
  alcohol_g: number; dose_bucket: string; consumed_at: string; ended_at: string | null;
  carb_g: number; abv_source: alc.AbvSource | null;
};

export async function getTodaySubstances(): Promise<Substance[]> {
  const { data } = await supabase.from("substance_log").select("id,substance,dose_bucket,amount,consumed_at,ended_at,drink_type,brand,volume_ml,abv,alcohol_g,carb_g,abv_source,caffeine_mg,drink_name")
    .eq("wake_date", logDate()).order("consumed_at");
  return (data as Substance[]) ?? [];
}
export async function logSubstance(substance: "alcohol" | "caffeine", doseBucket: string, amount?: number | null, consumedAt?: string) {
  const { error } = await supabase.from("substance_log").insert({
    wake_date: logDate(), substance, dose_bucket: doseBucket, amount: amount ?? null,
    consumed_at: consumedAt ?? new Date().toISOString(),
  });
  if (error) throw error;
}
// A caffeinated food or drink from the meal logger: its mg and name, with cups for the Drinks unit.
export async function logCaffeine(name: string, mg: number, consumedAt?: string) {
  const cups = cupsFor(mg);
  const { error } = await supabase.from("substance_log").insert({
    wake_date: logDate(), substance: "caffeine", dose_bucket: cups >= 4 ? "4+" : String(cups), amount: cups,
    consumed_at: consumedAt ?? new Date().toISOString(), caffeine_mg: mg, drink_name: name,
  });
  if (error) throw error;
}
export async function logAlcohol(e: AlcoholEntry) {
  const { error } = await supabase.from("substance_log").insert({ ...e, wake_date: logDate(), substance: "alcohol" });
  if (error) throw error;
}
export async function updateAlcohol(id: number, e: AlcoholEntry) {
  const { error } = await supabase.from("substance_log").update(e).eq("id", id);
  if (error) throw error;
}
// A brand's % alc and sugar: an earlier night where it was looked up or typed, else Claude.
// null = not known (keep the drink type's default); "error" = the lookup itself failed.
// serveMl: one drink's size, for a cocktail ("drink" unit) only
export type DrinkFacts = { abv: number; carb100: number | null; serveMl: number | null; name: string | null; from: "history" | "lookup"; site: string | null };
export async function lookupDrink(brand: string, type: string): Promise<DrinkFacts | null | "error"> {
  const { data } = await supabase.from("substance_log").select("brand,abv,abv_source,carb_g,volume_ml,amount,drink_type")
    .eq("substance", "alcohol").in("abv_source", ["lookup", "user"]).not("brand", "is", null)
    .order("consumed_at", { ascending: false }).limit(500); // newest 500, oldest first for knownBrand
  const seen = alc.knownBrand(((data as Parameters<typeof alc.knownBrand>[0]) ?? []).reverse(), brand);
  if (seen) return { ...seen, name: null, from: "history", site: null };
  try {
    const res = await fetch("/api/drink", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ brand, type }), signal: AbortSignal.timeout(60000) });
    if (!res.ok) return "error";
    const d = await res.json();
    return d.known ? { abv: d.abv, carb100: d.carb_100ml, serveMl: d.serve_ml ?? null, name: d.name ?? null, from: "lookup", site: siteOf(d.source_url) } : null;
  } catch { return "error"; }
}
export async function deleteSubstance(id: number) { await supabase.from("substance_log").delete().eq("id", id); }
export async function updateSubstance(id: number, doseBucket: string, amount: number | null, consumedAt: string, caffeineMg?: number | null) {
  const { error } = await supabase.from("substance_log").update({ dose_bucket: doseBucket, amount, consumed_at: consumedAt, ...(caffeineMg !== undefined ? { caffeine_mg: caffeineMg } : {}) }).eq("id", id);
  if (error) throw error;
}

// ── water: one tap per glass/bottle, timed at the tap (drinks table) ──────
// Backfilled taps store no time: a guessed one would be fake timing data.
export type Water = { id: string; volume_ml: number; logged_at: string | null };
export const waterSizes = (bottleMl: number) => [{ label: "glass", ml: 250 }, { label: "bottle", ml: bottleMl }];

// WHOOP's calorie burn for the day in view (its cycle covers that waking day; today's
// is a running total until you sleep). null when WHOOP has no figure for the day.
export async function getDayBurn(): Promise<number | null> {
  const { data, error } = await supabase.from("cycles").select("day_calories").eq("wake_date", logDate()).maybeSingle();
  if (error) console.error("burn", error);
  const v = (data as { day_calories: number | null } | null)?.day_calories;
  return v == null ? null : Math.round(Number(v));
}
// Calories in and out for the day in view (Today card). Eaten totals the way the Food page
// does (dishes, protein scoops, alcohol); burned is WHOOP's whole-day estimate above.
export type DayEnergy = { eaten: number; burned: number | null };
export async function getDayEnergy(): Promise<DayEnergy> {
  const [log, subs, burned] = await Promise.all([getTodayLog(), getTodaySubstances(), getDayBurn().catch(() => null)]);
  const food = log.reduce((a, i) => a + (i.kcal ?? 0), 0);
  const drinks = subs.reduce((a, s) => s.substance === "alcohol" && s.alcohol_g != null ? a + alc.drinkKcal(s.alcohol_g, s.carb_g) : a, 0);
  return { eaten: Math.round(food + drinks), burned };
}
export async function getTodayWater(): Promise<Water[]> {
  const { data, error } = await supabase.from("drinks").select("id,volume_ml,logged_at")
    .eq("wake_date", logDate()).eq("drink_name", "water").order("created_at");
  if (error) console.error("water", error);
  return (data as Water[]) ?? [];
}
// The caller makes the row (id included) so it can show the tap before the save lands.
export const newWater = (ml: number): Water =>
  ({ id: crypto.randomUUID(), volume_ml: ml, logged_at: isBackfill() ? null : new Date().toISOString() });
export async function logWater(w: Water) {
  const { error } = await supabase.from("drinks").insert({ ...w, wake_date: logDate(), drink_name: "water" });
  if (error) throw error;
}
export async function deleteWater(id: string) {
  const { error } = await supabase.from("drinks").delete().eq("id", id);
  if (error) throw error;
}

// ── supplements: name (suggested), dose, timing ────────────────────────────
export type Supplement = { id: string; supplement_name: string; dose_amount: number | null; dose_unit: string | null; logged_at: string; product_id: string | null; nutrients: Nutrient[] | null; brand: string | null };

export const SUPPLEMENT_SUGGESTIONS = [
  "Creatine", "Whey protein", "Caffeine pill", "Vitamin D3", "Omega-3", "Magnesium", "Zinc",
  "Ashwagandha", "Multivitamin", "Vitamin C", "Vitamin B12", "Electrolytes",
  "Beta-alanine", "Citrulline malate", "L-theanine", "Fish oil", "Probiotic",
  "Collagen", "Glutamine", "Tongkat ali", "Turmeric",
];

export async function getTodaySupplements(): Promise<Supplement[]> {
  const { data } = await supabase.from("supplements").select("id,supplement_name,dose_amount,dose_unit,logged_at,product_id,nutrients,brand")
    .eq("wake_date", logDate()).order("logged_at");
  return (data as Supplement[]) ?? [];
}
// Your own past supplements first, so suggestions learn what you actually take.
// What you'd usually take, so the dose box isn't a blank guess. Pills are counted;
// the mg on the label is optional detail. Your own last dose always wins over these.
export type Dose = { amount: number; unit: string };
const DOSE_DEFAULTS: Record<string, Dose> = {
  "multivitamin": { amount: 1, unit: "tablet" }, "omega-3": { amount: 1, unit: "caps" },
  "fish oil": { amount: 1, unit: "caps" }, "probiotic": { amount: 1, unit: "caps" },
  "vitamin d3": { amount: 1, unit: "tablet" }, "vitamin c": { amount: 1, unit: "tablet" },
  "vitamin b12": { amount: 1, unit: "tablet" }, "magnesium": { amount: 1, unit: "tablet" },
  "zinc": { amount: 1, unit: "tablet" }, "ashwagandha": { amount: 1, unit: "caps" },
  "turmeric": { amount: 1, unit: "caps" }, "tongkat ali": { amount: 1, unit: "caps" },
  "creatine": { amount: 5, unit: "g" }, "collagen": { amount: 10, unit: "g" },
  "glutamine": { amount: 5, unit: "g" }, "beta-alanine": { amount: 3, unit: "g" },
  "citrulline malate": { amount: 6, unit: "g" }, "l-theanine": { amount: 200, unit: "mg" },
  "whey protein": { amount: 1, unit: "scoop" },
  "caffeine pill": { amount: 200, unit: "mg" }, "caffeine": { amount: 200, unit: "mg" },
};
export const defaultDose = (name: string): Dose | null => DOSE_DEFAULTS[name.trim().toLowerCase()] ?? null;

// Names you've logged (newest first) and the last dose you logged for each.
export async function getSupplementHistory(): Promise<{ names: string[]; last: Record<string, Dose>; brand: Record<string, string> }> {
  const { data } = await supabase.from("supplements").select("supplement_name,dose_amount,dose_unit,brand")
    .order("logged_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as { supplement_name: string; dose_amount: number | null; dose_unit: string | null; brand: string | null }[];
  const last: Record<string, Dose> = {};
  const brand: Record<string, string> = {}; // the brand on the latest log that has one
  for (const r of rows) {
    const k = r.supplement_name.trim().toLowerCase();
    if (!(k in last) && r.dose_amount != null && r.dose_unit) last[k] = { amount: Number(r.dose_amount), unit: r.dose_unit };
    if (!(k in brand) && r.brand?.trim()) brand[k] = r.brand.trim();
  }
  return { names: [...new Set(rows.map((r) => r.supplement_name))], last, brand };
}
// The brand's label for a dose: the brand at log time, which product, and what that dose held.
// null = unmapped, logs as before. product_id / nutrients are null until a product is known.
export type SuppMap = { brand: string; product_id: string | null; nutrients: Nutrient[] | null } | null;
const mapCols = (m: SuppMap) => ({ brand: m?.brand ?? null, product_id: m?.product_id ?? null, nutrients: m?.nutrients ?? null });
export async function logSupplement(name: string, doseAmount: number | null, doseUnit: string | null, loggedAt?: string, map?: SuppMap): Promise<string> {
  const { data, error } = await supabase.from("supplements").insert({
    wake_date: logDate(), supplement_name: name, dose_amount: doseAmount, dose_unit: doseUnit,
    logged_at: loggedAt ?? new Date().toISOString(),
    ...(map ? mapCols(map) : {}),
  }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
// After the product is saved: tie the row to it and give it the dose's numbers.
export async function attachProduct(id: string, productId: string, nutrients: Nutrient[] | null) {
  const { error } = await supabase.from("supplements").update({ product_id: productId, nutrients }).eq("id", id);
  if (error) throw error;
}
export async function deleteSupplement(s: Supplement) {
  await supabase.from("supplements").delete().eq("id", s.id);
  await dropScoops(s);
}
// Edit in place. Its protein entry is dropped here; the caller re-adds it with the new numbers.
// The mapping is recomputed with the dose, so an edit never leaves a stale snapshot.
export async function updateSupplement(s: Supplement, name: string, doseAmount: number | null, doseUnit: string | null, loggedAt: string, map: SuppMap = null) {
  const { error } = await supabase.from("supplements")
    .update({ supplement_name: name, dose_amount: doseAmount, dose_unit: doseUnit, logged_at: loggedAt, ...mapCols(map) }).eq("id", s.id);
  if (error) throw error;
  await dropScoops(s);
}
// ── supplement products: the brand you take, mapped to its real label ───────
export type SupplementProduct = {
  id: string; name: string; brand: string; product: string | null; unit: string; per_unit: Nutrient[];
  source_url: string | null; note: string | null;
};
const PRODUCT_COLS = "id,name,brand,product,unit,per_unit,source_url,note";
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
// A handful of rows (one per supplement name), so the match on lower(name) is done here.
export async function getProducts(): Promise<SupplementProduct[]> {
  const { data } = await supabase.from("supplement_products").select(PRODUCT_COLS);
  return (data as SupplementProduct[]) ?? [];
}
export async function getProduct(name: string): Promise<SupplementProduct | null> {
  return (await getProducts()).find((p) => same(p.name, name)) ?? null;
}
export type FoundProduct = { product: string | null; unit: string; per_unit: Nutrient[]; source_url: string | null; note: string | null };
// One product per name, upserted on lower(name). Earlier rows of that name with no snapshot get one
// only on the FIRST mapping of the name (no product before, or the same brand with no numbers yet):
// a brand switch never touches old rows. `first` says whether that applied; `filled` is how many.
export async function saveProduct(name: string, brand: string, found: FoundProduct): Promise<{ product: SupplementProduct; filled: number; first: boolean }> {
  const row = { name: name.trim(), brand: brand.trim(), product: found.product, unit: found.unit, per_unit: found.per_unit, source_url: found.source_url, note: found.note, looked_up_at: new Date().toISOString() };
  const old = await getProduct(name);
  const first = !old || (old.per_unit.length === 0 && same(old.brand, brand));
  const q = old ? supabase.from("supplement_products").update(row).eq("id", old.id) : supabase.from("supplement_products").insert(row);
  const { data, error } = await q.select(PRODUCT_COLS).single();
  if (error) throw error;
  const product = data as SupplementProduct;
  let filled = 0;
  if (first && product.per_unit.length > 0) {
    // exact name, any case: ilike with the pattern characters escaped
    const exact = name.trim().replace(/[\\%_]/g, "\\$&");
    const { data: rows } = await supabase.from("supplements").select("id,supplement_name,dose_amount,dose_unit,brand").ilike("supplement_name", exact).is("nutrients", null);
    for (const r of (rows ?? []) as { id: string; supplement_name: string; dose_amount: number | null; dose_unit: string | null; brand: string | null }[]) {
      if (!same(r.supplement_name, name)) continue; // PostgREST reads * in an ilike as a wildcard
      if (r.brand && !same(r.brand, brand)) continue;
      const nutrients = scaleNutrients(product.per_unit, r.dose_amount == null ? null : Number(r.dose_amount), r.dose_unit, product.unit);
      if (!nutrients) continue;
      const { error: e2 } = await supabase.from("supplements").update({ product_id: product.id, brand: product.brand, nutrients }).eq("id", r.id);
      if (!e2) filled++;
    }
  }
  return { product, filled, first };
}
// The web lookup (api/supplement). null = no listing with the numbers; "error" = the lookup itself failed.
export async function lookupSupplement(name: string, brand: string): Promise<FoundProduct | null | "error"> {
  try {
    const res = await fetch("/api/supplement", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ name, brand }), signal: AbortSignal.timeout(90000) });
    if (!res.ok) return "error";
    const d = await res.json();
    return d.known ? { product: d.product ?? null, unit: d.unit, per_unit: d.per_unit, source_url: d.source_url ?? null, note: d.note ?? null } : null;
  } catch { return "error"; }
}

// a protein powder's food_log row (see logProteinScoops) goes with its supplement
async function dropScoops(s: Supplement) {
  if (!isProteinPowder(s.supplement_name)) return;
  await supabase.from("food_log").delete().eq("wake_date", logDate()).eq("food", s.supplement_name)
    .eq("brand", SUPP_BRAND).eq("eaten_at", s.logged_at);
}

// ── protein powder: a supplement that is also food ─────────────────────────
// Whey and the like also write a food_log row, so the protein counts in every
// total that reads food_log (Food, Progress, analysis). The row is marked by
// brand = SUPP_BRAND, shown under Supplements only. Per-scoop numbers are kept in
// the foods library under the supplement's name, so they're asked once.
export const SCOOP_G = 30;
export const SUPP_BRAND = "supplement";
export function isProteinPowder(name: string): boolean {
  return /\b(whey|casein|protein (powder|shake)|mass gainer|plant protein|pea protein)\b/i.test(name);
}
export type ScoopMacros = { protein: number; carbs: number; fat: number; kcal: number };
// kcal when the label's isn't given: 4 per g of protein and carbs, 9 per g of fat.
export const kcalOf = (m: Omit<ScoopMacros, "kcal">) => Math.round(4 * m.protein + 4 * m.carbs + 9 * m.fat);
export async function getScoopMacros(name: string): Promise<ScoopMacros | null> {
  const { data } = await supabase.from("foods").select("protein_100,carb_100,fat_100,kcal_100").eq("name", name).maybeSingle();
  if (!data) return null;
  const r = data as { protein_100: number; carb_100: number; fat_100: number; kcal_100: number };
  const s = (v: number) => Math.round((v * SCOOP_G) / 10) / 10; // per scoop, to 0.1 g
  return { protein: s(r.protein_100), carbs: s(r.carb_100), fat: s(r.fat_100), kcal: Math.round((r.kcal_100 * SCOOP_G) / 100) };
}
export async function logProteinScoops(name: string, scoops: number, perScoop: ScoopMacros, at: string) {
  const k = 100 / SCOOP_G;
  await upsertFood({ name, brand: null, kcal_100: perScoop.kcal * k, protein_100: perScoop.protein * k, carb_100: perScoop.carbs * k, fat_100: perScoop.fat * k, source: "manual" });
  await logFood({
    slot: null, food: name, brand: SUPP_BRAND, grams: Math.round(SCOOP_G * scoops), eatenAt: at,
    kcal: Math.round(perScoop.kcal * scoops), protein_g: Math.round(perScoop.protein * scoops),
    carb_g: Math.round(perScoop.carbs * scoops), fat_g: Math.round(perScoop.fat * scoops),
  });
}
