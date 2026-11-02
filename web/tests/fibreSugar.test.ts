import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayFibreSugar, fibreSugarLine } from '../lib/fibreSugar.ts';

test('sums known values and counts dishes missing either value', () => {
  const t = dayFibreSugar([{ fibre_g: 3, sugar_g: 5 }, { fibre_g: 2.5, sugar_g: null }, { fibre_g: null, sugar_g: null }, {}]);
  assert.deepEqual(t, { fibre: 5.5, sugar: 5, unknown: 3, show: true });
});

test('alcohol carbs count as sugar', () => {
  const t = dayFibreSugar([{ fibre_g: 4, sugar_g: 10 }], 12.5);
  assert.equal(t.sugar, 22.5);
  assert.equal(t.fibre, 4);
  assert.equal(t.unknown, 0);
});

test('hidden when no dish has a value, even with alcohol', () => {
  assert.equal(dayFibreSugar([], 0).show, false);
  assert.equal(dayFibreSugar([{ fibre_g: null, sugar_g: null }], 8).show, false);
});

test('a zero is a known value, not unknown', () => {
  const t = dayFibreSugar([{ fibre_g: 0, sugar_g: 0 }]);
  assert.equal(t.show, true);
  assert.equal(t.unknown, 0);
});

test('line wording: singular, plural, none', () => {
  assert.equal(fibreSugarLine({ fibre: 12, sugar: 30, unknown: 0, show: true }), 'fibre 12 g · sugar 30 g');
  assert.equal(fibreSugarLine({ fibre: 12, sugar: 30, unknown: 1, show: true }), 'fibre 12 g · sugar 30 g · 1 dish unknown');
  assert.equal(fibreSugarLine({ fibre: 12, sugar: 30, unknown: 2, show: true }), 'fibre 12 g · sugar 30 g · 2 dishes unknown');
});
