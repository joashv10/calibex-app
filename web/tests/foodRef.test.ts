import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OFF_TABLE_PIECES, REFS, findRef, refByName, pickFor, withOil, guard, resolveDish, blockingAsk, editedBasis, LIMITS, type RawDish, type AskDish } from '../lib/foodRef.ts';

const raw = (o: Partial<RawDish>): RawDish => ({
  food: 'X', portion: 'regular', grams_small: 100, grams_regular: 200, grams_large: 300,
  kcal_100: 150, protein_100: 5, carb_100: 20, fat_100: 5, fibre_100: null, sugar_100: null, cooked: true, dose_mg: 0, caffeine_100: 0,
  source: 'estimate', basis: 'estimate', ref: '', count: 0, size: '', drink: false, out: false, grams_said: 0, unit: '', unit_g: 0, ...o,
});

test('every table food is internally consistent', () => {
  const keys = new Set<string>();
  for (const r of REFS) {
    assert.ok(!keys.has(r.key), `duplicate key ${r.key}`); keys.add(r.key);
    const p = r.per100;
    assert.ok(p.protein_100 + p.carb_100 + p.fat_100 <= 100, `${r.key}: macros over 100 g`);
    const atw = 4 * p.protein_100 + 4 * p.carb_100 + 9 * p.fat_100;
    assert.ok(Math.abs(p.kcal_100 - atw) <= Math.max(15, atw * 0.2), `${r.key}: kcal ${p.kcal_100} vs macros ${atw.toFixed(0)}`);
    if (r.serve.kind === 'piece') assert.ok(r.serve.g > 0 && r.serve.dflt > 0, `${r.key}: unit`);
    assert.ok(r.src.length > 0, `${r.key}: no source`);
  }
});

test('the reported breakfast: "roti + egg curry" with no counts → 2 roti, 2 eggs, both asked', () => {
  const roti = resolveDish(raw({ food: 'Roti', ref: 'roti', grams_regular: 160 }));
  assert.equal(roti.source, 'table');
  assert.equal(roti.grams.regular, 2 * findRef('roti')!.serve.g!);
  assert.equal(roti.ask, true);
  const curry = resolveDish(raw({ food: 'Egg Curry', ref: 'egg_curry', grams_regular: 250, protein_100: 11.6 }));
  assert.equal(curry.source, 'table');
  const g = curry.grams.regular, p = (curry.per100.protein_100 * g) / 100;
  assert.ok(p <= 16, `2-egg curry protein ${p}`); // two eggs ≈ 12–13 g + a little from gravy
  assert.equal(curry.ask, true);
});

test('a stated count is used and not asked; model grams are ignored for table foods', () => {
  const d = resolveDish(raw({ food: 'Roti', ref: 'roti', count: 3, grams_regular: 400 }));
  assert.equal(d.grams.regular, 3 * findRef('roti')!.serve.g!);
  assert.equal(d.ask, false);
  assert.equal(d.pick!.opts[d.pick!.i].label, '3');
});

test('half and odd counts get their own chip', () => {
  const p = pickFor(findRef('roti')!, 1.5, '');
  assert.deepEqual(p.opts.map((o) => o.label), ['1', '1.5', '2', '3', '4']);
  assert.equal(p.opts[p.i].label, '1.5');
  const six = pickFor(findRef('roti')!, 6, '');
  assert.equal(six.opts[six.i].label, '6');
});

test('bowl foods: stated size used, else default katori and asked', () => {
  const bowlKey = REFS.find((r) => r.serve.kind === 'bowl' && !r.serve.g)!.key; // a food on the generic bowls
  const said = resolveDish(raw({ ref: bowlKey, size: 'bowl' }));
  assert.equal(said.grams.regular, 250); assert.equal(said.ask, false);
  const unsaid = resolveDish(raw({ ref: bowlKey, size: '' }));
  assert.equal(unsaid.pick!.opts[unsaid.pick!.i].label, (findRef(bowlKey)!.serve as { dflt: string }).dflt);
  assert.equal(unsaid.ask, true);
});

test('label and web numbers are never replaced by the table or the guard', () => {
  const d = resolveDish(raw({ food: 'Roti', ref: 'roti', source: 'label', kcal_100: 300, protein_100: 9, carb_100: 55, fat_100: 5, basis: 'label: per 100 g' }));
  assert.equal(d.source, 'label');
  assert.equal(d.per100.kcal_100, 300);
  assert.equal(d.ask, undefined);
});

test('an unknown ref key falls back to a guarded estimate', () => {
  const d = resolveDish(raw({ ref: 'nonsense' }));
  assert.equal(d.source, 'estimate');
});

test('a caffeine dose is never turned into a table food', () => {
  const d = resolveDish(raw({ ref: 'roti', dose_mg: 200 }));
  assert.notEqual(d.source, 'table');
});

test('guard: kcal that the macros cannot carry comes down', () => {
  const g = guard('Paneer Tikka', { kcal_100: 400, protein_100: 10, carb_100: 10, fat_100: 10 }); // macros = 170 kcal
  assert.equal(g.per100.kcal_100, 170); assert.ok(g.adjusted);
});

test('guard: macros that say more than the kcal shrink to it', () => {
  const g = guard('Chicken Curry', { kcal_100: 150, protein_100: 20, carb_100: 10, fat_100: 15 }); // macros = 255 kcal
  const atw = 4 * g.per100.protein_100 + 4 * g.per100.carb_100 + 9 * g.per100.fat_100;
  assert.ok(Math.abs(atw - 150) < 3, `macros now ${atw}`); assert.ok(g.adjusted);
});

test('guard: protein caps (meat vs everything else) and the kcal ceiling', () => {
  assert.equal(guard('Grilled Chicken', { kcal_100: 200, protein_100: 45, carb_100: 0, fat_100: 2 }).per100.protein_100 <= LIMITS.maxProtein100, true);
  assert.equal(guard('Vegetable Pulao', { kcal_100: 160, protein_100: 25, carb_100: 25, fat_100: 2 }).per100.protein_100 <= LIMITS.maxProtein100Plain, true);
  assert.ok(guard('Jalebi', { kcal_100: 800, protein_100: 2, carb_100: 70, fat_100: 30 }).per100.kcal_100 <= LIMITS.maxKcal100);
});

test('guard: sane numbers pass untouched', () => {
  const g = guard('Pasta Alfredo', { kcal_100: 180, protein_100: 6, carb_100: 22, fat_100: 7.5 });
  assert.equal(g.adjusted, false);
});

test('a big single helping of an estimate asks for its size; a big drink does not', () => {
  assert.equal(resolveDish(raw({ grams_regular: LIMITS.bigPortionG + 50 })).ask, true);
  assert.equal(resolveDish(raw({ grams_regular: 500, drink: true })).ask, false);
  assert.equal(resolveDish(raw({ grams_regular: 250 })).ask, false);
});

test('oil chips move only the added fat on a table dish', () => {
  const r = REFS.find((x) => x.oil100 > 0)!;
  const lo = withOil(r, 'low'), hi = withOil(r, 'high'), n = withOil(r, 'normal');
  assert.deepEqual(n, { ...r.per100, fibre_100: r.per100.fibre_100 ?? null, sugar_100: r.per100.sugar_100 ?? null }); // unknown fibre/sugar = null
  assert.ok(lo.fat_100 < n.fat_100 && hi.fat_100 > n.fat_100);
  assert.equal(lo.protein_100, n.protein_100);
});

test('names map to table foods exactly, never by substring', () => {
  assert.equal(refByName('Chapati')?.key, 'roti');
  assert.equal(refByName('rotis')?.key, 'roti');
  assert.equal(refByName('Rumali Roti'), null);
});

test('guard leaves real fats and nuts alone', () => {
  assert.equal(guard('Ghee', { kcal_100: 900, protein_100: 0, carb_100: 0, fat_100: 100 }).adjusted, false);
  assert.equal(guard('Roasted Peanuts', { kcal_100: 567, protein_100: 26, carb_100: 16, fat_100: 49 }).per100.protein_100, 26);
  assert.equal(guard('Cheese slice', { kcal_100: 310, protein_100: 20, carb_100: 6, fat_100: 23 }).per100.protein_100, 20);
});

test('guard: a kcal with no macros is kept, not zeroed', () => {
  assert.equal(guard('Sweet', { kcal_100: 100, protein_100: 0, carb_100: 0, fat_100: 0 }).per100.kcal_100, 100);
});

test('a tiny count becomes half a piece, never a 0 g chip', () => {
  const p = pickFor(findRef('paratha')!, 0.1, '');
  assert.equal(p.opts[p.i].label, '0.5'); assert.ok(p.opts[p.i].g > 0);
});

test('a stated count past 8 is kept but asked', () => {
  const p = pickFor(findRef('roti')!, 20, '');
  assert.equal(p.opts[p.i].label, '20'); assert.equal(p.ask, true);
  assert.equal(pickFor(findRef('idli')!, 6, '').ask, false);
});

test('a table chai keeps the model caffeine', () => {
  assert.equal(resolveDish(raw({ food: 'Chai', ref: 'chai', count: 2, caffeine_100: 20, drink: true })).caffeine_100, 20);
});

test('dal fry is the tadka dal', () => assert.equal(refByName('Dal Fry')?.key, 'dal_tadka'));

test('eaten out: table dishes start on high oil and a bowl, and say so', () => {
  const dosa = resolveDish(raw({ food: 'Masala Dosa', ref: 'masala_dosa', out: true }));
  assert.equal(dosa.oil, 'high'); assert.ok(dosa.per100.kcal_100 > findRef('masala_dosa')!.per100.kcal_100);
  assert.equal(dosa.basis, 'food table · eaten out');
  const dal = resolveDish(raw({ food: 'Dal', ref: 'dal_tadka', out: true }));
  assert.equal(dal.pick!.opts[dal.pick!.i].label, 'bowl'); assert.equal(dal.ask, true);
  const said = resolveDish(raw({ food: 'Dal', ref: 'dal_tadka', out: true, size: 'katori' }));
  assert.equal(said.pick!.opts[said.pick!.i].label, 'katori');
  const home = resolveDish(raw({ food: 'Masala Dosa', ref: 'masala_dosa' }));
  assert.equal(home.oil, 'normal'); { const p0 = findRef('masala_dosa')!.per100; assert.deepEqual(home.per100, { ...p0, fibre_100: p0.fibre_100 ?? null, sugar_100: p0.sugar_100 ?? null }); }
  const roti = resolveDish(raw({ food: 'Roti', ref: 'roti', out: true }));
  assert.equal(roti.oil, 'normal'); // no added oil to scale
});

test('a table food the model left unref\'d is still matched by name', () => {
  assert.equal(resolveDish(raw({ food: 'Kadala Curry', ref: '' })).source, 'table');
  assert.equal(resolveDish(raw({ food: 'Kadala Curry', ref: '', source: 'label' })).source, 'label');
});

test('porotta and bhatura are table foods; restaurant dosas are bigger', () => {
  const p = resolveDish(raw({ food: 'Porotta', ref: '', count: 2 }));
  assert.equal(p.source, 'table'); assert.equal(p.grams.regular, 160);
  assert.equal(refByName('Bhature')?.key, 'bhatura');
  assert.equal(resolveDish(raw({ ref: 'masala_dosa', out: true })).grams.regular, 200);
  assert.equal(resolveDish(raw({ ref: 'masala_dosa' })).grams.regular, 150);
  assert.equal(resolveDish(raw({ ref: 'samosa', count: 2 })).grams.regular, 160);
  assert.equal(resolveDish(raw({ ref: 'idli', out: true, count: 2 })).grams.regular, 76);
});

test('only sourced rows say "food table"; assumed ones say "typical"', () => {
  assert.equal(resolveDish(raw({ ref: 'roti' })).basis, 'food table');
  assert.equal(resolveDish(raw({ ref: 'porotta' })).basis, 'typical');
  assert.equal(resolveDish(raw({ ref: 'appam', out: true })).basis, 'typical · eaten out');
});

test('batch 2: new dishes resolve, and plain names do not over-match', () => {
  for (const [name, key] of [['Chicken 65', 'chicken_65'], ['Idiyappam', 'idiyappam'], ['Neychoru', 'ghee_rice'], ['Butter Chicken', 'butter_chicken'], ['Buttermilk', 'moru'], ['Egg Fried Rice', 'egg_fried_rice']] as const)
    assert.equal(refByName(name)?.key, key, name);
  // Tikka, tandoori, kappa and sprouts got their own rows in batch 3; the bare words still match nothing.
  for (const n of ['Chicken', 'Pav Bhaji', 'Mutton', 'Tikka', 'Tandoori', 'Roll', 'Curry'])
    assert.equal(refByName(n), null, n);
});

// ── stated grams, countable estimates, the one blocking question, portions ──
test('grams said on a table dish: a "<n> g" chip is added and selected, not asked', () => {
  const fry = resolveDish(raw({ food: 'Fish Fry', ref: 'fish_fry', grams_said: 200 }));
  assert.equal(fry.source, 'table');
  assert.equal(fry.pick!.opts[fry.pick!.i].label, '200 g');
  assert.equal(fry.grams.regular, 200); assert.equal(fry.ask, false);
  assert.ok(fry.pick!.opts.some((o) => o.label === '3'), 'normal chips stay');
  const rice = resolveDish(raw({ food: 'Rice', ref: 'rice', grams_said: 250 }));
  assert.equal(rice.grams.regular, 250); assert.equal(rice.ask, false);
  assert.deepEqual(rice.pick!.opts.map((o) => o.g), [150, 250, 250, 350]);
});

test('grams said on an estimate: used as the regular weight, no size question even past the big-portion limit', () => {
  const d = resolveDish(raw({ grams_said: 500, grams_regular: 300 }));
  assert.equal(d.grams.regular, 500); assert.equal(d.portion, 'regular'); assert.equal(d.ask, false);
  assert.equal(resolveDish(raw({ grams_regular: 500 })).ask, true); // unsaid: still asks
});

test('countable estimate food: chips of one piece, count asked unless said, basis assumption in the pick', () => {
  const cookie = { food: 'Cookie Man Chocolate Chip Cookie', unit: 'cookie', unit_g: 20, kcal_100: 490, protein_100: 6, carb_100: 60, fat_100: 25 };
  const d = resolveDish(raw(cookie));
  assert.equal(d.source, 'estimate');
  assert.deepEqual(d.pick!.opts.map((o) => o.g), [20, 40, 60, 80]);
  assert.equal(d.pick!.opts[d.pick!.i].label, '1'); assert.equal(d.ask, true); assert.equal(d.pick!.unit, 'cookie');
  const two = resolveDish(raw({ ...cookie, count: 2 }));
  assert.equal(two.pick!.opts[two.pick!.i].g, 40); assert.equal(two.ask, false);
  const six = resolveDish(raw({ ...cookie, count: 6 }));
  assert.equal(six.pick!.opts[six.pick!.i].label, '6'); assert.equal(six.ask, false);
  assert.equal(resolveDish(raw({ ...cookie, unit_g: 900 })).pick!.opts[0].g, 300); // one piece clamped to 300 g
  const said = resolveDish(raw({ ...cookie, grams_said: 90 }));
  assert.equal(said.pick, undefined); assert.equal(said.grams.regular, 90); assert.equal(said.ask, false);
  assert.equal(resolveDish(raw({ unit: '', unit_g: 20 })).pick, undefined); // no unit name: ordinary estimate
});

test('resolveDish carries the drink flag for the logger', () => {
  assert.equal(resolveDish(raw({ drink: true })).drink, true);
  assert.equal(resolveDish(raw({ ref: 'roti' })).drink, false);
});

// kcal of one resolved dish at its selected chip and at the next chip up
const askOf = (d: ReturnType<typeof resolveDish>): AskDish => {
  const k = (g: number) => (d.per100.kcal_100 * g) / 100;
  const p = 'pick' in d ? d.pick : undefined;
  const now = k(p ? p.opts[p.i].g : d.grams.regular);
  return { asking: !!d.ask, isDrink: !!d.drink, kcalNow: now, kcalNext: p && p.opts[p.i + 1] ? k(p.opts[p.i + 1].g) : now };
};
const run = (dishes: ReturnType<typeof resolveDish>[]) => {
  const a = dishes.map(askOf);
  return blockingAsk(a, a.reduce((t, x) => t + x.kcalNow, 0));
};

test('blockingAsk: a lone chai at 1 cup does not block (swing ~44 kcal)', () => {
  assert.equal(run([resolveDish(raw({ food: 'Chai', ref: 'chai', drink: true }))]), -1);
  assert.equal(run([resolveDish(raw({ food: 'Boiled Egg', ref: 'boiled_egg' }))]), -1); // 2 → 3 eggs: 74 kcal
});

test('blockingAsk: a Kerala lunch with nothing said blocks exactly one, the biggest swing', () => {
  const lunch = [
    resolveDish(raw({ food: 'Rice', ref: 'rice' })), resolveDish(raw({ food: 'Sambar', ref: 'sambar' })),
    resolveDish(raw({ food: 'Thoran', ref: 'thoran' })), resolveDish(raw({ food: 'Fish Curry', ref: 'fish_curry' })),
  ];
  assert.ok(lunch.every((d) => d.ask));
  assert.equal(run(lunch), 0); // rice: katori → bowl is +120 kcal of ~520
  // answering it leaves nobody over the bar here
  const a = lunch.map(askOf); a[0].asking = false;
  assert.equal(blockingAsk(a, a.reduce((t, x) => t + x.kcalNow, 0)), -1);
});

test('blockingAsk: a cookie going 1 → 2 (~100 kcal, the whole meal) blocks', () => {
  const cookie = resolveDish(raw({ food: 'Cookie', unit: 'cookie', unit_g: 20, kcal_100: 490, protein_100: 6, carb_100: 60, fat_100: 25 }));
  assert.equal(run([cookie]), 0);
});

test('blockingAsk: drinks and stated amounts never block', () => {
  const big: AskDish = { asking: true, isDrink: true, kcalNow: 100, kcalNext: 400 };
  assert.equal(blockingAsk([big], 100), -1);
  assert.equal(blockingAsk([{ ...big, isDrink: false, asking: false }], 100), -1);
  assert.equal(blockingAsk([{ ...big, isDrink: false, kcalNext: 100 }], 100), -1); // grams-only dish: no next option
  assert.equal(run([resolveDish(raw({ food: 'Rice', ref: 'rice', size: 'bowl' }))]), -1); // size said
  assert.equal(run([resolveDish(raw({ food: 'Fish Fry', ref: 'fish_fry', grams_said: 200 }))]), -1);
});

test('blockingAsk: both thresholds apply (80 kcal and 20% of the meal)', () => {
  const d = (swing: number): AskDish => ({ asking: true, isDrink: false, kcalNow: 200, kcalNext: 200 + swing });
  assert.equal(blockingAsk([d(79)], 100), -1);          // under 80 kcal
  assert.equal(blockingAsk([d(80)], 400), 0);           // exactly 80 and 20%
  assert.equal(blockingAsk([d(90)], 1000), -1);         // under 20% of a big meal
  assert.equal(blockingAsk([d(100), d(150)], 500), 1);  // biggest wins
});

test('poha and upma carry their own bowl weights; other bowl foods keep the generic ones', () => {
  const plate = resolveDish(raw({ food: 'Poha', ref: 'poha', size: 'plate' }));
  assert.equal(plate.grams.regular, 200);
  assert.deepEqual(resolveDish(raw({ ref: 'poha' })).pick!.opts.map((o) => o.g), [100, 150, 200]);
  assert.deepEqual(resolveDish(raw({ ref: 'upma' })).pick!.opts.map((o) => o.g), [120, 180, 250]);
  assert.deepEqual(resolveDish(raw({ ref: 'rice' })).pick!.opts.map((o) => o.g), [150, 250, 350]);
});

test('editedBasis: stale portion text becomes grams + source + edited; label bases stay', () => {
  assert.equal(editedBasis('1 katori · 150 g · food table', 100), '100 g · food table · edited');
  assert.equal(editedBasis('200 g · typical · eaten out', 120), '120 g · typical · eaten out · edited');
  assert.equal(editedBasis('100 g · food table · edited', 80), '80 g · food table · edited');
  assert.equal(editedBasis('2 cookie ≈ 40 g · AI estimate', 30), '30 g · AI estimate · edited');
  assert.equal(editedBasis('label: per 100 g × 260 g serving', 100), 'label: per 100 g × 260 g serving');
  assert.equal(editedBasis(null, 100), null);
});

test('batch 3 foods: names land on their own rows, portions follow the table', () => {
  // Kadala curry and egg roast used to fall through to chole / egg curry; they have their own rows now.
  assert.equal(refByName('Kadala Curry')?.key, 'kadala_curry');
  assert.equal(refByName('Egg Roast')?.key, 'egg_roast');
  assert.equal(refByName('Chana Masala')?.key, 'chole');
  assert.equal(refByName('Momos')?.key, 'chicken_momos');
  assert.equal(refByName('Protein Bowl')?.key, 'chicken_rice_bowl');
  assert.equal(refByName('Toast')?.key, 'bread');
  assert.equal(resolveDish(raw({ ref: 'chicken_momos', count: 6 })).grams.regular, 150);
  assert.equal(resolveDish(raw({ ref: 'maggi' })).grams.regular, 250);
  assert.equal(resolveDish(raw({ ref: 'bread', count: 2 })).grams.regular, 54);
  assert.equal(resolveDish(raw({ ref: 'grilled_chicken_breast', grams_said: 150 })).grams.regular, 150);
});

test("the reader prompt's off-table piece examples really are off the table", () => {
  for (const n of OFF_TABLE_PIECES) assert.equal(refByName(n), null, n);
});

// ── fibre and sugar ──
test('guard: sugar is clamped to carbs, fibre capped at 40, and the row counts as adjusted', () => {
  const g = guard('Fruit Bar', { kcal_100: 200, protein_100: 2, carb_100: 40, fat_100: 2, fibre_100: 55, sugar_100: 60 });
  assert.equal(g.per100.sugar_100, 40);
  assert.equal(g.per100.fibre_100, 40);
  assert.equal(g.adjusted, true);
});

test('guard: fibre and sugar already in range are untouched and not flagged', () => {
  const g = guard('Oats', { kcal_100: 180, protein_100: 5, carb_100: 30, fat_100: 3, fibre_100: 8, sugar_100: 2 });
  assert.equal(g.per100.fibre_100, 8);
  assert.equal(g.per100.sugar_100, 2);
  assert.equal(g.adjusted, false);
});

test('guard: null or missing fibre and sugar pass through as null, never 0', () => {
  const a = guard('Sweet', { kcal_100: 100, protein_100: 2, carb_100: 15, fat_100: 3, fibre_100: null, sugar_100: null });
  assert.equal(a.per100.fibre_100, null);
  assert.equal(a.per100.sugar_100, null);
  assert.equal(a.adjusted, false);
  const b = guard('Sweet', { kcal_100: 100, protein_100: 2, carb_100: 15, fat_100: 3 });
  assert.equal(b.per100.fibre_100, null);
  assert.equal(b.per100.sugar_100, null);
});

test('guard: sugar follows carbs down when the macro clamps shrink them', () => {
  // macros 4·10 + 4·60 + 9·0 = 280 kcal vs 100 stated: carbs shrink, sugar must not exceed the new carbs
  const g = guard('Syrup', { kcal_100: 100, protein_100: 10, carb_100: 60, fat_100: 0, fibre_100: null, sugar_100: 55 });
  assert.ok(g.per100.sugar_100! <= g.per100.carb_100);
  assert.equal(g.adjusted, true);
});

test('guard: fibre and sugar are never pulled up', () => {
  const g = guard('Dal', { kcal_100: 100, protein_100: 6, carb_100: 15, fat_100: 1, fibre_100: 3, sugar_100: 1 });
  assert.ok(g.per100.fibre_100! <= 3 && g.per100.sugar_100! <= 1);
});

test('table row without fibre/sugar yields null through withOil and resolveDish', () => {
  const ref = findRef('hakka_noodles')!; // INDB-derived: no honest fibre/sugar source
  assert.equal(withOil(ref, 'normal').fibre_100, null);
  assert.equal(withOil(ref, 'high').sugar_100, null);
  const d = resolveDish(raw({ food: 'Hakka Noodles', ref: 'hakka_noodles' }));
  assert.equal(d.per100.fibre_100, null);
  assert.equal(d.per100.sugar_100, null);
});

test('table row with fibre/sugar carries them through withOil (oil adds none)', () => {
  const ref = findRef('roti')!;
  assert.equal(withOil(ref, 'high').fibre_100, 8.6);
  assert.equal(withOil(ref, 'high').sugar_100, 1.4);
});

test('resolveDish: model estimate keeps null fibre/sugar null and clamps numbers', () => {
  const n = resolveDish(raw({ food: 'Mystery Snack', fibre_100: null, sugar_100: null }));
  assert.equal(n.per100.fibre_100, null);
  assert.equal(n.per100.sugar_100, null);
  const big = resolveDish(raw({ food: 'Mystery Snack', carb_100: 20, fibre_100: 90, sugar_100: 80 }));
  assert.equal(big.per100.fibre_100, 40);
  assert.equal(big.per100.sugar_100, 20);
});

test("food table: every row has fibre/sugar researched, and they fit the row", () => {
  for (const r of REFS) {
    const { fibre_100: f, sugar_100: s, protein_100, carb_100, fat_100 } = r.per100;
    assert.ok(f !== undefined && s !== undefined, `${r.key} missing from FIBRE_SUGAR`);
    if (s != null) assert.ok(s <= carb_100, `${r.key} sugar ${s} > carb ${carb_100}`);
    if (f != null) assert.ok(f + protein_100 + carb_100 + fat_100 <= 100, `${r.key} over 100 g`);
  }
});

test('sugarFor(): sugar never reads above the rounded carbs, for every table row and portion', async () => {
  const { sugarFor } = await import('../lib/fibreSugar.ts');
  for (const r of REFS) for (const g of [35, 50, 70, 75, 100, 150, 200, 250, 350]) {
    const k = g / 100, carb = Math.round(r.per100.carb_100 * k);
    const raw = r.per100.sugar_100 == null ? null : Math.round(r.per100.sugar_100 * k * 10) / 10;
    const s = sugarFor(raw, carb);
    if (s != null) assert.ok(s <= carb, `${r.key} ${g} g: sugar ${s} > carb ${carb}`);
  }
  assert.equal(sugarFor(null, 5), null);
  assert.equal(sugarFor(3.3, null), 3.3);
});
