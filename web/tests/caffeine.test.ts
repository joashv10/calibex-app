import { test } from "node:test";
import assert from "node:assert/strict";
import { caffeineMg, caffeinePer100, cupsFor, caffeineTotal } from "../lib/caffeine.ts";

test("reader figure wins: a 355 ml Red Bull is 114 mg, one cup", () => {
  assert.equal(caffeineMg("Red Bull Energy Drink (Regular)", 355, 32), 114);
  assert.equal(cupsFor(114), 1);
});
test("by name when the reader gave none", () => {
  assert.equal(caffeineMg("Chai", 150), 30);
  assert.equal(caffeineMg("Coffee", 150), 60);
  assert.equal(caffeineMg("Caramel Iced Latte", 400), 100);
  assert.equal(caffeineMg("Double espresso", 60), 126);
  assert.equal(caffeineMg("Pepsi Black", 330), 33);
});
test("a small chai still counts; a trace in food does not", () => {
  assert.equal(caffeineMg("Chai", 100, 20), 20);
  assert.equal(caffeineMg("Dark chocolate", 20, 40), 0);
});
test("decaf, herbal and coffee-flavoured food have none", () => {
  for (const f of ["Decaf coffee", "Herbal tea", "Coffee cake", "Espresso martini", "Tiramisu"]) assert.equal(caffeinePer100(f), 0, f);
  assert.equal(caffeineMg("Decaf latte", 300), 0);
});
test("reader says none → none", () => assert.equal(caffeineMg("Chai", 150, 0), 0));
test("decaffeinated has none; ice tea is the low iced-tea figure; capped at 2000 mg", () => {
  assert.equal(caffeineMg("Decaffeinated coffee", 150), 0);
  assert.equal(caffeineMg("Lipton ice tea", 300), 15);
  assert.equal(caffeineMg("Mystery shot", 600, 400), 2000);
});

test("day total adds caffeine pills from Supplements to drinks", () => {
  const drinks = [{ substance: "caffeine", caffeine_mg: 100, amount: 1 }, { substance: "alcohol", caffeine_mg: null, amount: 2 }];
  const pills = [
    { supplement_name: "Caffeine pill", dose_amount: 200, dose_unit: "mg" },
    { supplement_name: "Whey protein", dose_amount: 1, dose_unit: "scoop" },
    { supplement_name: "Caffeine-free pre-workout", dose_amount: 300, dose_unit: "mg" },
  ];
  assert.equal(caffeineTotal(drinks, pills), "Caffeine today: about 300 mg");
});

test("day total: a pill alone shows; unsized cups and pills are named, not guessed", () => {
  assert.equal(caffeineTotal([], [{ supplement_name: "Caffeine pill", dose_amount: 200, dose_unit: "mg" }]), "Caffeine today: about 200 mg");
  assert.equal(
    caffeineTotal([{ substance: "caffeine", caffeine_mg: null, amount: 2 }], [{ supplement_name: "Caffeine pill", dose_amount: 200, dose_unit: "MG" }, { supplement_name: "caffeine tablet", dose_amount: 1, dose_unit: "tablet" }]),
    "Caffeine today: about 200 mg + 2 cups + 1 pill not sized",
  );
  assert.equal(caffeineTotal([], []), null);
});

test("day total reads a caffeine gum's mg from its label, per piece taken", () => {
  const gum = { supplement_name: "Neuro Gum Caffeine", dose_amount: 2, dose_unit: "tablet",
    nutrients: [{ key: "caffeine", amount: 80, unit: "mg" }, { key: "vit_b6", amount: 1, unit: "mg" }] };
  assert.equal(caffeineTotal([], [gum]), "Caffeine today: about 80 mg");
  // a pre-workout with caffeine on its label counts though its name doesn't say caffeine
  const pre = { supplement_name: "Pre-workout", dose_amount: 1, dose_unit: "scoop", nutrients: [{ key: "caffeine", amount: 0.15, unit: "g" }] };
  assert.equal(caffeineTotal([], [pre, { supplement_name: "Caffeine pill", dose_amount: 200, dose_unit: "mg", nutrients: null }]), "Caffeine today: about 350 mg");
  // a gum with no label yet is named, not guessed
  assert.equal(caffeineTotal([{ substance: "caffeine", caffeine_mg: 100, amount: 1 }], [{ ...gum, nutrients: null }]), "Caffeine today: about 100 mg + 1 pill not sized");
});

test("a caffeine pill in mg counts its dose once, even with label caffeine on the row", () => {
  assert.equal(caffeineTotal([], [{ supplement_name: "Caffeine pill", dose_amount: 200, dose_unit: "mg", nutrients: [{ key: "caffeine", amount: 200, unit: "mg" }] }]), "Caffeine today: about 200 mg");
});
