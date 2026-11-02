import { test } from 'node:test';
import assert from 'node:assert/strict';
import { energyBalance, type EnergyFood, type EnergySkip, type EnergyBurn, type EnergyWeight, type EnergySub } from '../lib/energy.ts';

const TODAY = '2026-10-21'; // window: 14..20 Oct
const D = (n: number) => `2026-10-${String(n).padStart(2, '0')}`;
const meals = (d: string, kcal = 2000, slots = ['breakfast', 'lunch', 'dinner']): EnergyFood[] =>
  slots.map((slot) => ({ wake_date: d, slot, kcal: kcal / slots.length, brand: null }));
const burnOn = (ds: number[], kcal = 2200): EnergyBurn[] => ds.map((n) => ({ wake_date: D(n), day_calories: kcal, cycle_end: `${D(n)}T20:00:00Z` }));
const run = (food: EnergyFood[], burn: EnergyBurn[], extra: { skips?: EnergySkip[]; weights?: EnergyWeight[]; substances?: EnergySub[] } = {}) =>
  energyBalance({ food, burn, skips: extra.skips ?? [], weights: extra.weights ?? [], substances: extra.substances }, TODAY);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

test('closed at 4 of 7 fully logged, open at 5 of 7', () => {
  const four = run(range(14, 17).flatMap((n) => meals(D(n))), burnOn(range(14, 20)));
  assert.equal(four.gated, true);
  assert.equal(four.logged, 4);
  assert.equal(four.eatenAvg, null);
  const five = run(range(14, 18).flatMap((n) => meals(D(n))), burnOn(range(14, 20)));
  assert.equal(five.gated, false);
  assert.equal(five.logged, 5);
  assert.equal(five.eatenAvg, 2000);
  assert.equal(five.burnAvg, 2200);
  assert.equal(five.diffAvg, -200);
});

test('today is excluded from the window', () => {
  const r = run(range(14, 21).flatMap((n) => meals(D(n))), burnOn(range(14, 21)));
  assert.deepEqual(r.days, range(14, 20).map(D));
  assert.equal(r.logged, 7);
  const onlyToday = run(range(16, 21).flatMap((n) => meals(D(n))), burnOn(range(14, 21)));
  assert.equal(onlyToday.logged, 5); // 16..20; the 21st doesn't make a sixth
});

test('a day with no afternoon entry still counts', () => {
  const r = run(range(14, 18).flatMap((n) => meals(D(n), 2000, ['breakfast', 'lunch', 'dinner'])), burnOn(range(14, 18)));
  assert.equal(r.logged, 5);
});

test('a day with lunch unknown does not count; a skipped lunch does', () => {
  const noLunch = (n: number) => meals(D(n), 2000, ['breakfast', 'dinner']);
  const base = [...range(14, 17).flatMap((n) => meals(D(n))), ...noLunch(18)];
  assert.equal(run(base, burnOn(range(14, 18))).logged, 4);
  const skipped = run(base, burnOn(range(14, 18)), { skips: [{ wake_date: D(18), slot: 'lunch' }] });
  assert.equal(skipped.logged, 5);
});

test('a protein scoop (brand supplement) does not make a slot eaten', () => {
  const scoop: EnergyFood = { wake_date: D(18), slot: 'lunch', kcal: 120, brand: 'supplement' };
  const base = [...range(14, 17).flatMap((n) => meals(D(n))), ...meals(D(18), 2000, ['breakfast', 'dinner']), scoop];
  const r = run(base, burnOn(range(14, 18)));
  assert.equal(r.logged, 4);
});

test('a day without a burn value does not count', () => {
  const r = run(range(14, 18).flatMap((n) => meals(D(n))), burnOn(range(14, 17)));
  assert.equal(r.logged, 4);
  assert.equal(r.gated, true);
});

test('alcohol kcal is included (7 per g alcohol + 4 per g sugar), scoops too', () => {
  const food = [...range(14, 18).flatMap((n) => meals(D(n)))];
  const subs: EnergySub[] = [{ wake_date: D(14), substance: 'alcohol', alcohol_g: 20, carb_g: 5 }]; // 160 kcal
  const scoop: EnergyFood = { wake_date: D(15), slot: 'breakfast', kcal: 100, brand: 'supplement' };
  const r = run([...food, scoop], burnOn(range(14, 18), 2000), { substances: subs });
  assert.equal(r.eatenAvg, 2052); // (2000*5 + 160 + 100) / 5
});

// scale check
const wts = (a: [number, number], b: [number, number]): EnergyWeight[] => [
  { wake_date: D(a[0]), value: a[1], measured_at: `${D(a[0])}T07:00:00Z` },
  { wake_date: D(b[0]), value: b[1], measured_at: `${D(b[0])}T07:00:00Z` },
];

test('scale check stays closed when the weigh-ins are under 14 days apart', () => {
  const r = run(range(8, 20).flatMap((n) => meals(D(n))), burnOn(range(8, 20)), { weights: wts([8, 62], [20, 62.5]) });
  assert.equal(r.scale.open, false);
});

test('scale check stays closed when under 70% of the days between are fully logged', () => {
  // weigh-ins 1 and 19 Oct = 18 days; only 12 logged (66%)
  const r = run(range(8, 19).flatMap((n) => meals(D(n))), burnOn(range(1, 19)), { weights: wts([1, 62], [19, 62.5]) });
  assert.equal(r.scale.open, false);
});

test('scale check maths when open', () => {
  // weigh-ins 6 and 20 Oct (14 days between: 6..19), 14 of 14 logged
  const r = run(range(6, 19).flatMap((n) => meals(D(n), 2000)), burnOn(range(6, 20), 2300), { weights: wts([6, 62], [20, 62.7]) });
  assert.equal(r.scale.open, true);
  if (r.scale.open) {
    assert.equal(r.scale.spanDays, 14);
    assert.equal(r.scale.scalePerDay, Math.round((0.7 * 7700) / 14)); // +385
    assert.equal(r.scale.logPerDay, -300);
    assert.equal(r.scale.scaleRange, Math.round((Math.SQRT2 * 0.5 * 7700) / 14)); // 389
    assert.equal(r.scale.consistent, false); // gap 685 > 389
  }
});

test('with no weigh-ins the scale check is closed', () => {
  assert.equal(run([], []).scale.open, false);
});

test('a cycle still running (cycle_end null) is not a complete burn day', () => {
  const food = range(14, 18).flatMap((n) => meals(D(n)));
  const burn = burnOn(range(14, 18)).map((b) => (b.wake_date === D(18) ? { ...b, cycle_end: null } : b));
  const r = run(food, burn);
  assert.equal(r.logged, 4);
  assert.equal(r.gated, true);
});

test('scale range is 1.41 x 0.5 kg x 7700 / days, and consistent when the log falls inside it', () => {
  // log -300/day vs scale: 0 kg change -> 0 +/- 389; 300 < 389 so consistent
  const r = run(range(6, 19).flatMap((n) => meals(D(n), 2000)), burnOn(range(6, 20), 2300), { weights: wts([6, 62], [20, 62]) });
  assert.equal(r.scale.open, true);
  if (r.scale.open) {
    assert.equal(r.scale.scalePerDay, 0);
    assert.equal(r.scale.scaleRange, 389);
    assert.equal(r.scale.consistent, true);
  }
});
