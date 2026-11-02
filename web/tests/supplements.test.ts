import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brandable, fmtNutrient, notMapped, nutrientSummary, rescaleNutrients, perUnitNutrients, scaleNutrients, pageUrls, siteOf, sumNutrients, unitsTaken, verifiedSource, type Nutrient,
} from "../lib/supplements.ts";

const D: Nutrient = { key: "vit_d", label: "Vit D", amount: 25, unit: "mcg" };
const Z: Nutrient = { key: "zinc", label: "Zinc", amount: 6, unit: "mg" };

test("tablet and caps are interchangeable counts; everything else must match", () => {
  assert.equal(unitsTaken(2, "caps", "tablet"), 2);
  assert.equal(unitsTaken(1, "tablet", "caps"), 1);
  assert.equal(unitsTaken(2, "scoop", "scoop"), 2);
  assert.equal(unitsTaken(5, "g", "g"), 5);
  assert.equal(unitsTaken(30, "ml", "ml"), 30);
  assert.equal(unitsTaken(2, "scoop", "tablet"), null);
  assert.equal(unitsTaken(200, "mg", "tablet"), null); // magnesium logged in mg against a per-tablet label
  assert.equal(unitsTaken(5, "g", "ml"), null);
  assert.equal(unitsTaken(0, "tablet", "tablet"), null);
  assert.equal(unitsTaken(2, null, "tablet"), null);
});

test("a missing dose counts as one unit, whatever the unit says", () => {
  assert.equal(unitsTaken(null, null, "tablet"), 1);
  assert.deepEqual(scaleNutrients([D], null, null, "scoop"), [D]);
});

test("scaleNutrients multiplies by the dose and refuses incompatible units", () => {
  assert.deepEqual(scaleNutrients([D, Z], 2, "tablet", "caps"), [{ ...D, amount: 50 }, { ...Z, amount: 12 }]);
  assert.deepEqual(scaleNutrients([{ ...Z, amount: 0.1 }], 3, "caps", "tablet"), [{ ...Z, amount: 0.3 }]); // no float dust
  assert.equal(scaleNutrients([D], 200, "mg", "tablet"), null);
  assert.equal(scaleNutrients([], 1, "tablet", "tablet"), null); // nothing known is null, not an empty snapshot
  assert.deepEqual([D].map((x) => x.amount), [25]); // input untouched
});

test("sumNutrients totals per key and unit and never mixes IU with mcg", () => {
  const t = sumNutrients([[D, Z], [{ ...D, amount: 10 }], null, undefined, [{ key: "vit_d", label: "Vit D", amount: 400, unit: "IU" }]]);
  assert.deepEqual(t, [
    { key: "vit_d", label: "Vit D", amount: 400, unit: "IU" },
    { key: "vit_d", label: "Vit D", amount: 35, unit: "mcg" },
    Z,
  ]);
  assert.deepEqual(sumNutrients([null, undefined, []]), []);
});

test("'other' lines add up only with the same label", () => {
  const c: Nutrient = { key: "other", label: "Curcumin", amount: 100, unit: "mg" };
  const t = sumNutrients([[c], [{ ...c, label: "curcumin" }], [{ ...c, label: "Piperine", amount: 5 }]]);
  assert.deepEqual(t.map((x) => [x.label, x.amount]), [["Curcumin", 200], ["Piperine", 5]]);
});

test("summary: first four in label order, then '+N more'", () => {
  const ns = sumNutrients([[Z, D, { key: "iron", label: "Iron", amount: 9, unit: "mg" }, { key: "vit_c", label: "Vit C", amount: 80, unit: "mg" }, { key: "vit_b12", label: "B12", amount: 6, unit: "mcg" }, { key: "calcium", label: "Calcium", amount: 100.456, unit: "mg" }]]);
  assert.equal(nutrientSummary(ns), "Vit C 80 mg · Vit D 25 mcg · B12 6 mcg · Calcium 100 mg · +2 more");
  assert.equal(nutrientSummary([D]), "Vit D 25 mcg");
  assert.equal(nutrientSummary([]), "");
});

test("verifiedSource accepts only a page the search returned", () => {
  const seen = ["https://www.healthkart.com/product/hk-vitals-multivitamin/", "https://www.amazon.in/dp/B0X?th=1"];
  assert.equal(verifiedSource("https://healthkart.com/product/hk-vitals-multivitamin", seen), true); // www, slash
  assert.equal(verifiedSource("http://www.healthkart.com/product/hk-vitals-multivitamin#facts", seen), true);
  assert.equal(verifiedSource("https://www.amazon.in/dp/B0X?th=1", seen), true);
  assert.equal(verifiedSource("https://www.amazon.in/dp/B0X", seen), false); // a different query is a different page
  assert.equal(verifiedSource("https://www.healthkart.com/product/other", seen), false);
  assert.equal(verifiedSource("https://evil.com/?u=https://www.healthkart.com/product/hk-vitals-multivitamin", seen), false);
  assert.equal(verifiedSource("javascript:alert(1)", ["javascript:alert(1)"]), false);
  assert.equal(verifiedSource("not a url", ["not a url"]), false);
  assert.equal(verifiedSource(null, seen), false);
  assert.equal(verifiedSource("https://www.healthkart.com/product/hk-vitals-multivitamin", []), false);
});

test("pageUrls reads web_search_tool_result blocks and skips errors and other blocks", () => {
  const urls = pageUrls([
    { type: "text", content: "hi" },
    { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://a.com/x", title: "A" }, { type: "web_search_result", url: "https://b.com/y" }] },
    { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
    { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: "https://c.com/z", content: {} } },
    { type: "web_fetch_tool_result", content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" } },
    { type: "tool_use" },
  ]);
  assert.deepEqual(urls, ["https://a.com/x", "https://b.com/y", "https://c.com/z"]);
});

test("siteOf shows the bare host", () => {
  assert.equal(siteOf("https://www.healthkart.com/p/1"), "healthkart.com");
  assert.equal(siteOf("nonsense"), null);
  assert.equal(siteOf(null), null);
});

test("perUnitNutrients divides by the serving and drops bad lines", () => {
  const out = perUnitNutrients([
    { key: "vit_d", label: "whatever", amount: 50, unit: "mcg" },
    { key: "zinc", label: "Zinc", amount: -1, unit: "mg" },
    { key: "iron", label: "Iron", amount: Infinity, unit: "mg" },
    { key: "iron", label: "Iron", amount: NaN, unit: "mg" },
    { key: "calcium", label: "Calcium", amount: 0, unit: "mg" },
    { key: "bogus", label: "Bogus", amount: 3, unit: "mg" },
    { key: "zinc", label: "Zinc", amount: 3, unit: "oz" },
    { key: "other", label: "Curcumin", amount: 500, unit: "mg" },
    { key: "vit_c", label: "Vit C", amount: "80", unit: "mg" },
  ], 2);
  assert.deepEqual(out, [
    { key: "vit_d", label: "Vit D", amount: 25, unit: "mcg" },
    { key: "other", label: "Curcumin", amount: 250, unit: "mg" },
  ]);
  assert.deepEqual(perUnitNutrients([D], 0), []);
  assert.deepEqual(perUnitNutrients("x", 1), []);
});

test("brand search is for supplements and caffeine products, not protein powders", () => {
  assert.equal(brandable("Multivitamin"), true);
  assert.equal(brandable("Fish oil"), true);
  assert.equal(brandable("Whey protein - Only What's Needed"), false);
  assert.equal(brandable("Caffeine pill"), true);
  assert.equal(brandable("Neuro Gum Caffeine"), true);
});

test("tiny amounts keep their significant figures; zeros and absurd values are dropped", () => {
  const out = perUnitNutrients([
    { key: "vit_b12", label: "B12", amount: 0.0004, unit: "mg" },
    { key: "vit_b12", label: "B12", amount: 0.00123456, unit: "mg" },
    { key: "zinc", label: "Zinc", amount: 12345678, unit: "mg" }, // 12 kg in a tablet
    { key: "iron", label: "Iron", amount: 51, unit: "g" },
    { key: "vit_d", label: "Vit D", amount: 60_000_000, unit: "mcg" },
    { key: "vit_a", label: "Vit A", amount: 2_000_000, unit: "IU" },
    { key: "vit_c", label: "Vit C", amount: 1234, unit: "mg" },
  ], 1);
  assert.deepEqual(out.map((x) => [x.key, x.amount]), [["vit_b12", 0.0004], ["vit_b12", 0.00123456], ["vit_c", 1234]]);
  assert.deepEqual(scaleNutrients([{ key: "vit_b12", label: "B12", amount: 0.0004, unit: "mg" }], 2, "tablet", "tablet")?.[0].amount, 0.0008);
});

test("rescaleNutrients works from the row's own snapshot", () => {
  // 2 tablets held 25 mcg D (12.5 each); 3 tablets hold 37.5
  assert.deepEqual(rescaleNutrients([D, { ...Z, amount: 12 }], 2, "tablet", 3, "caps"), [{ ...D, amount: 37.5 }, { ...Z, amount: 18 }]);
  assert.deepEqual(rescaleNutrients([D], null, null, 2, "tablet", "tablet"), [{ ...D, amount: 50 }]); // no old dose = 1 unit
  assert.equal(rescaleNutrients([D], 2, "tablet", 5, "mg"), null); // new dose in mg can't be read against a tablet label
  assert.equal(rescaleNutrients([D], 2, "scoop", 1, "tablet"), null);
  assert.equal(rescaleNutrients([D], null, null, 2, "tablet"), null); // unit unknown anywhere
});

test("notMapped counts supplements without numbers, never powders or caffeine taken in mg", () => {
  assert.equal(notMapped([
    { supplement_name: "Multivitamin", nutrients: null },
    { supplement_name: "Fish oil", nutrients: [] },
    { supplement_name: "Creatine", nutrients: [D] },
    { supplement_name: "Whey protein", nutrients: null },
    { supplement_name: "Caffeine pill", nutrients: null, dose_amount: 200, dose_unit: "mg" },
  ]), 2);
  // a gum taken by the piece with no label yet is genuinely unknown
  assert.equal(notMapped([{ supplement_name: "Neuro Gum Caffeine", nutrients: null, dose_amount: 2, dose_unit: "tablet" }]), 1);
});

test("a full serving shows the label's figure, not a rounded-per-unit one", () => {
  const shown = (label: number, serving: number, take: number, unit: "mg" | "mcg" = "mcg") => {
    const per = perUnitNutrients([{ key: "vit_b12", label: "B12", amount: label, unit }], serving);
    return fmtNutrient(scaleNutrients(per, take, "tablet", "tablet")![0]);
  };
  assert.equal(shown(10, 3, 3), "B12 10 mcg");
  assert.equal(shown(1000, 3, 3, "mg"), "B12 1000 mg");
  assert.equal(shown(80, 7, 7, "mg"), "B12 80 mg");
});

test("label caffeine over 500 mg a unit is a misread and dropped, not summed", () => {
  const per = perUnitNutrients([
    { key: "caffeine", label: "Caffeine", amount: 80, unit: "mg" },
  ], 2);
  assert.deepEqual(per.map((x) => [x.key, x.amount]), [["caffeine", 40]]);
  assert.deepEqual(perUnitNutrients([{ key: "caffeine", label: "Caffeine", amount: 2400, unit: "mg" }], 1), []);
  assert.deepEqual(perUnitNutrients([{ key: "caffeine", label: "Caffeine", amount: 0.6, unit: "g" }], 1), []);
  assert.equal(perUnitNutrients([{ key: "caffeine", label: "Caffeine", amount: 0.2, unit: "g" }], 1).length, 1);
});
