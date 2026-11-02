// Supplements mapped to a brand's real label: what one tablet / capsule / scoop holds,
// scaled to the dose you took. Pure (no Supabase), so the tests can run it. The
// lookups themselves are in api/supplement; the saving is in food.ts.
// Unknown is null, never 0. IU and mcg are never converted into each other: the
// conversion differs per vitamin, so a mix stays as two lines.

import { isCaffeinePill } from "./caffeine.ts";

export type NutrientUnit = "mg" | "mcg" | "g" | "IU";
export const NUTRIENT_UNITS: NutrientUnit[] = ["mg", "mcg", "g", "IU"];
export type Nutrient = { key: string; label: string; amount: number; unit: NutrientUnit };

// The fixed key list the lookup may record, in display order. "other" keeps its own label.
export const NUTRIENTS: { key: string; label: string }[] = [
  { key: "vit_a", label: "Vit A" }, { key: "vit_c", label: "Vit C" }, { key: "vit_d", label: "Vit D" },
  { key: "vit_e", label: "Vit E" }, { key: "vit_k", label: "Vit K" },
  { key: "vit_b1", label: "B1" }, { key: "vit_b2", label: "B2" }, { key: "vit_b3", label: "B3" },
  { key: "vit_b5", label: "B5" }, { key: "vit_b6", label: "B6" }, { key: "vit_b7", label: "B7" },
  { key: "vit_b9", label: "Folate" }, { key: "vit_b12", label: "B12" },
  { key: "calcium", label: "Calcium" }, { key: "magnesium", label: "Magnesium" }, { key: "zinc", label: "Zinc" },
  { key: "iron", label: "Iron" }, { key: "selenium", label: "Selenium" }, { key: "iodine", label: "Iodine" },
  { key: "copper", label: "Copper" }, { key: "manganese", label: "Manganese" }, { key: "chromium", label: "Chromium" },
  { key: "potassium", label: "Potassium" },
  { key: "epa", label: "EPA" }, { key: "dha", label: "DHA" }, { key: "omega3", label: "Omega-3" },
  { key: "caffeine", label: "Caffeine" },
  { key: "other", label: "Other" },
];
export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key);
const ORDER = new Map(NUTRIENT_KEYS.map((k, i) => [k, i]));

// What one unit of a product is. tablet and caps are both just a count.
export type ProductUnit = "tablet" | "caps" | "scoop" | "g" | "ml";
export const PRODUCT_UNITS: ProductUnit[] = ["tablet", "caps", "scoop", "g", "ml"];
const family = (u: string) => (u === "tablet" || u === "caps" ? "count" : u);

// How many product units a dose is, or null when the dose unit can't be read as them
// (mg of magnesium against a tablet label, IU, a scoop against a tablet). No dose = 1 unit.
export function unitsTaken(doseAmount: number | null, doseUnit: string | null, productUnit: string): number | null {
  if (doseAmount == null) return 1;
  if (!Number.isFinite(doseAmount) || doseAmount <= 0) return null;
  if (!doseUnit || family(doseUnit) !== family(productUnit) || !PRODUCT_UNITS.includes(productUnit as ProductUnit)) return null;
  return doseAmount;
}

// Significant figures, not decimals: a B12 of 0.0004 mg must stay 0.0004, never round to 0.
const sig = (v: number, n = 6) => Number(v.toPrecision(n));
// Per-unit ceilings; a figure above them is a misread label, not a real one (50 g of anything in a tablet).
const MAX: Record<NutrientUnit, number> = { mg: 50000, mcg: 50_000_000, g: 50, IU: 1_000_000 };
const CAFFEINE_MAX_MG = 500;

// A product's per-unit nutrients × the dose taken. null when the units don't line up.
export function scaleNutrients(perUnit: Nutrient[], doseAmount: number | null, doseUnit: string | null, productUnit: string): Nutrient[] | null {
  const n = unitsTaken(doseAmount, doseUnit, productUnit);
  if (n == null || perUnit.length === 0) return null;
  return perUnit.map((x) => ({ ...x, amount: sig(x.amount * n) }));
}

// A logged row's own snapshot at a new dose: per-unit = nutrients ÷ old units, then × new units.
// productUnit is only needed when the old dose had no unit. null when the units don't line up.
export function rescaleNutrients(ns: Nutrient[], oldAmount: number | null, oldUnit: string | null, newAmount: number | null, newUnit: string | null, productUnit?: string | null): Nutrient[] | null {
  const pu = oldUnit ?? productUnit ?? null;
  if (!pu || ns.length === 0) return null;
  const was = unitsTaken(oldAmount, oldUnit ?? pu, pu);
  const now = unitsTaken(newAmount, newUnit ?? pu, pu);
  if (was == null || now == null) return null;
  return ns.map((x) => ({ ...x, amount: sig((x.amount / was) * now) }));
}

// Totals per key and unit. "other" lines are told apart by their label. Rows with no
// snapshot (null) add nothing; they are unknown, not zero.
export function sumNutrients(rows: (Nutrient[] | null | undefined)[]): Nutrient[] {
  const tot = new Map<string, Nutrient>();
  for (const r of rows) {
    for (const x of r ?? []) {
      const k = `${x.key}|${x.unit}${x.key === "other" ? `|${x.label.toLowerCase()}` : ""}`;
      const cur = tot.get(k);
      if (cur) cur.amount = sig(cur.amount + x.amount); else tot.set(k, { ...x, amount: sig(x.amount) });
    }
  }
  return [...tot.values()].sort((a, b) => (ORDER.get(a.key) ?? 99) - (ORDER.get(b.key) ?? 99) || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));
}

export const fmtNutrient = (n: Nutrient) => `${n.label} ${n.amount >= 100 ? Math.round(n.amount) : sig(n.amount, 3)} ${n.unit}`;

// "Vit D 25 mcg · Zinc 12 mg · Iron 9 mg · B12 6 mcg · +3 more", the first `top` in label order.
export function nutrientSummary(ns: Nutrient[], top = 4): string {
  if (ns.length === 0) return "";
  const parts = ns.slice(0, top).map(fmtNutrient);
  if (ns.length > top) parts.push(`+${ns.length - top} more`);
  return parts.join(" · ");
}

// A brand's label lookup is not for protein powders (they have their own scoop lookup).
// Caffeine products get it: a gum or tablet's label says how much caffeine one piece holds.
export const brandable = (name: string) => !/\b(whey|casein|protein (powder|shake)|mass gainer|plant protein|pea protein)\b/i.test(name);

// Today's supplements that could have a label but have no numbers. Protein powders never do,
// and a caffeine product taken in mg already says all there is to know.
export const notMapped = (rows: { supplement_name: string; nutrients: Nutrient[] | null; dose_unit?: string | null; dose_amount?: number | null }[]) =>
  rows.filter((r) => brandable(r.supplement_name) && !(r.nutrients && r.nutrients.length)
    && !(isCaffeinePill(r.supplement_name) && r.dose_amount != null && r.dose_unit?.toLowerCase() === "mg")).length;

// ── reading a web-search response (server side) ────────────────────────────

// The pages a response really looked at: web-search results and fetched pages. Structural, so it
// takes the SDK's BetaContentBlock[] as it is:
//   { type: "web_search_tool_result", content: Array<{ type: "web_search_result", url }> | { type: "web_search_tool_result_error" } }
//   { type: "web_fetch_tool_result",  content: { type: "web_fetch_result", url } | { type: "web_fetch_tool_result_error" } }
export function pageUrls(blocks: { type: string; content?: unknown }[]): string[] {
  const urls: string[] = [];
  for (const b of blocks) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content as { type?: string; url?: unknown }[]) if (r?.type === "web_search_result" && typeof r.url === "string") urls.push(r.url);
    } else if (b.type === "web_fetch_tool_result") {
      const c = b.content as { type?: string; url?: unknown } | undefined; // an error result has no url
      if (c?.type === "web_fetch_result" && typeof c.url === "string") urls.push(c.url);
    }
  }
  return urls;
}

function norm(u: string): string | null {
  try {
    const x = new URL(u);
    if (x.protocol !== "https:" && x.protocol !== "http:") return null;
    return `${x.hostname.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${x.search}`;
  } catch { return null; }
}
// The page the numbers came from must be one the search returned or the fetch opened. Ignores
// scheme, "www.", a trailing slash and the #fragment, nothing else.
export function verifiedSource(url: string | null | undefined, resultUrls: string[]): boolean {
  const u = url ? norm(url) : null;
  return !!u && resultUrls.some((r) => norm(r) === u);
}
// "https://www.healthkart.com/…" → "healthkart.com"
export function siteOf(url: string | null | undefined): string | null {
  try { return url ? new URL(url).hostname.replace(/^www\./, "") : null; } catch { return null; }
}

// The record tool's nutrients (per serving) → per ONE unit, kept to 6 significant figures so a full
// serving still adds back to the label (10 mcg per 3 tablets, take 3 → 10); only display rounds. Drops anything
// not on the fixed list, non-finite, zero, negative or above the unit's ceiling.
export function perUnitNutrients(raw: unknown, servingUnits: number): Nutrient[] {
  if (!Array.isArray(raw) || !Number.isFinite(servingUnits) || servingUnits <= 0) return [];
  const out: Nutrient[] = [];
  for (const x of raw as Partial<Nutrient>[]) {
    const amount = typeof x?.amount === "number" ? x.amount : NaN;
    if (!x || !ORDER.has(String(x.key)) || !NUTRIENT_UNITS.includes(x.unit as NutrientUnit) || !Number.isFinite(amount) || amount <= 0) continue;
    const per = sig(amount / servingUnits);
    const max = MAX[x.unit as NutrientUnit];
    if (!(per > 0) || amount > max || per > max) continue;
    // No caffeine pill, gum or scoop holds over 500 mg; a bigger figure is a misread (per 100 g, wrong serving).
    if (x.key === "caffeine" && per * ({ mg: 1, g: 1000, mcg: 0.001, IU: Infinity } as const)[x.unit as NutrientUnit] > CAFFEINE_MAX_MG) continue;
    const std = NUTRIENTS.find((n) => n.key === x.key)!;
    const label = x.key === "other" ? String(x.label ?? "").trim().slice(0, 30) || "Other" : std.label;
    out.push({ key: x.key!, label, amount: per, unit: x.unit as NutrientUnit });
  }
  return out.slice(0, 40);
}
