import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alcoholG, bucketOf, nightLabel, amountLabel, drinksLabel, windowError, DRINKS } from '../lib/alcohol.ts';

test('a 30 ml peg of 42.8% is one standard drink', () => {
  assert.equal(alcoholG(30, 42.8), 10.1);
  assert.equal(drinksLabel(alcoholG(30, 42.8)), '≈1 drink');
});

test('beer and wine grams', () => {
  assert.equal(alcoholG(650, 8), 41);     // one strong 650
  assert.equal(alcoholG(3 * 330, 5), 39.1);
  assert.equal(alcoholG(2 * 150, 12), 28.4);
});

test('bucket follows standard drinks', () => {
  assert.equal(bucketOf(alcoholG(60, 42.8)), '1-2');   // 2 pegs
  assert.equal(bucketOf(alcoholG(90, 42.8)), '3-4');   // 3 pegs
  assert.equal(bucketOf(alcoholG(150, 42.8)), '5+');   // 5 pegs
  assert.equal(bucketOf(alcoholG(650, 8)), '3-4');     // one strong 650 ≈ 4.1 drinks
});

test('labels', () => {
  assert.equal(amountLabel('whisky', 3, 30), '3 pegs');
  assert.equal(amountLabel('whisky', 1, 30), '1 peg');
  assert.equal(amountLabel('beer', 2, 650), '2 bottles · 650 ml');
  assert.equal(amountLabel('wine', 1, DRINKS.wine.ml), '1 glass');
  assert.equal(drinksLabel(13), '≈1.3 drinks');
  assert.equal(drinksLabel(52), '≈5 drinks');
});

test('window checks', () => {
  const at = (s: string) => new Date(s);
  assert.equal(windowError(at('2026-10-10T20:00:00'), null), null);
  assert.equal(windowError(at('2026-10-10T20:00:00'), at('2026-10-11T01:30:00')), null); // past midnight
  assert.match(windowError(at('2026-10-10T20:00:00'), at('2026-10-10T19:00:00'))!, /before it starts/);
  assert.match(windowError(at('2026-10-10T08:00:00'), at('2026-10-11T01:00:00'))!, /14 hours/);
});

test('a night reads as one total', () => {
  assert.equal(nightLabel([]), null);
  assert.equal(nightLabel([{ dose_bucket: '3-4', alcohol_g: 39.1 }, { dose_bucket: '1-2', alcohol_g: 20.2 }]), '≈6 drinks');
  assert.equal(nightLabel([{ dose_bucket: '5+', alcohol_g: null }, { dose_bucket: '1-2', alcohol_g: 10 }]), '5+ drinks + 1–2 drinks');
});

test('drink calories: 7 per g alcohol + 4 per g sugar; old rows count alcohol only', async () => {
  const { drinkKcal, carbG } = await import('../lib/alcohol.ts');
  // 12 pegs of Fireball at 33%: 95 g alcohol, ~11 g sugar per 100 ml
  const g = alcoholG(12 * 30, 33);
  assert.equal(g, 93.7);
  assert.equal(carbG(360, 11), 39.6);
  assert.equal(drinkKcal(g, carbG(360, 11)), 814);
  assert.equal(drinkKcal(g, null), 656);
  assert.equal(drinkKcal(null, null), 0);
  assert.equal(DRINKS.whisky.carb100, 0);
  assert.equal(carbG(650, DRINKS.strong_beer.carb100), 26);
});

test('a brand is only reused from a looked-up or typed %, never a type default', async () => {
  const { knownBrand } = await import('../lib/alcohol.ts');
  const old = { brand: 'Fireball', abv: 42.8, abv_source: null, carb_g: null, volume_ml: 360 };
  const dflt = { brand: 'Fireball', abv: 42.8, abv_source: 'default', carb_g: 0, volume_ml: 360 };
  assert.equal(knownBrand([old, dflt], 'Fireball'), null);
  const looked = { brand: 'Fireball', abv: 33, abv_source: 'lookup', carb_g: 39.6, volume_ml: 360 };
  assert.deepEqual(knownBrand([looked, old], ' fireball '), { abv: 33, carb100: 11, serveMl: null });
  const typed = { brand: 'Old Monk', abv: 42.8, abv_source: 'user', carb_g: null, volume_ml: 60 };
  assert.deepEqual(knownBrand([looked, typed], 'old monk'), { abv: 42.8, carb100: null, serveMl: null });
  const liit = { brand: 'Long Island Iced Tea', abv: 15, abv_source: 'lookup', carb_g: 25, volume_ml: 500, amount: 2, drink_type: 'cocktail' };
  assert.equal(knownBrand([liit], 'long island iced tea').serveMl, 250);
  assert.equal(knownBrand([looked], ''), null);
  assert.equal(knownBrand([looked], 'Fireball Blast'), null);
});
