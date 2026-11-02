import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotPicks } from '../lib/recents.ts';

const r = (food: string, slot: string | null, grams = 100) => ({ food, slot, grams });
// newest first, as getRecentFoods returns them
const rows = [
  r('Chai', 'breakfast', 150),
  r('Juicy Masala Shawaya Chicken', 'dinner', 200),
  r('Mayonnaise', 'dinner', 30),
  r('Idli', 'breakfast'),
  r('chai ', 'breakfast', 120),
  r('Chai', 'afternoon'),
  r('Dosa', 'breakfast'),
  r('Mystery', null),
];

test('breakfast picks only breakfast foods: no shawaya, no mayo', () => {
  const p = slotPicks(rows, 'breakfast').map((x) => x.food);
  assert.deepEqual(p, ['Chai', 'Idli', 'Dosa']);
  assert.ok(!p.some((f) => /shawaya|mayonnaise/i.test(f)));
});

test('dinner picks only dinner foods', () => {
  assert.deepEqual(slotPicks(rows, 'dinner').map((x) => x.food), ['Juicy Masala Shawaya Chicken', 'Mayonnaise']);
});

test('the same food differing only in case or spaces counts once, with its newest grams', () => {
  const p = slotPicks(rows, 'breakfast');
  assert.equal(p.filter((x) => x.food.trim().toLowerCase() === 'chai').length, 1);
  assert.equal(p[0].grams, 150);
});

test('more often at this meal ranks first, then more recent', () => {
  const p = slotPicks([r('Poha', 'breakfast'), r('Oats', 'breakfast'), r('Oats', 'breakfast'), r('Upma', 'breakfast')], 'breakfast');
  assert.deepEqual(p.map((x) => x.food), ['Oats', 'Poha', 'Upma']);
});

test('a meal with no history shows no picks; rows without a meal never show', () => {
  assert.deepEqual(slotPicks(rows, 'lunch'), []);
  assert.deepEqual(slotPicks([r('Mystery', null)], 'breakfast'), []);
  assert.deepEqual(slotPicks([], 'dinner'), []);
});

test('limit caps the picks', () => {
  const many = Array.from({ length: 20 }, (_, i) => r(`Food ${i}`, 'lunch'));
  assert.equal(slotPicks(many, 'lunch').length, 8);
  assert.equal(slotPicks(many, 'lunch', 3).length, 3);
});
