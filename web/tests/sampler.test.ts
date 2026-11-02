import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { sampleTouchpoint, orderForCapture } from '../lib/sampler.ts';
import type { Item, SamplerState } from '../lib/types.ts';

// Dinner pool as in calibex_v2_seed.sql after migration 016 (017 later moved SQ3 to lunch): [id, facet, protective, any_meal/per_occurrence, fixed]
const POOL: [string, string, boolean, boolean, boolean][] = [
  ['AA1', 'adherence', true, false, false], ['AA2', 'adherence', false, false, false],
  ['AF1', 'fatigue', false, false, false], ['AF3', 'fatigue', true, false, false],
  ['RS1', 'somatic', false, false, false], ['RS2', 'somatic', false, false, false],
  ['RS3', 'cognitive', false, false, false], ['RS4', 'cognitive', true, false, false],
  ['SD1', 'daytime', false, false, false], ['SD2', 'daytime', false, false, false], ['SD3', 'daytime', true, false, false],
  ['PR1', 'soreness', false, false, false], ['PR2', 'soreness', false, false, false],
  ['NR1', 'regulation', false, true, false], ['NR2', 'regulation', false, true, false], ['NR3', 'regulation', false, false, false],
  ['NC1', 'cravings', false, false, false], ['NC2', 'cravings', false, false, false],
  ['AL1', 'alcohol', false, false, true], ['FD1', 'composition', false, false, true],
  ['LD1', 'load', false, false, false], ['LD2', 'load', false, false, false],
  ['CN1', 'connection', true, false, false], ['CN2', 'connection', false, false, false],
  ['FR1', 'friction', false, false, false], ['FR2', 'friction', false, false, false],
];
const items: Item[] = POOL.map(([item_id, facet, is_protective, anyMeal, fixed]) => ({
  item_id, dimension_id: 'd', facet, prompt: item_id, response_type: 'boolean', options: [], severity_map: {},
  is_protective, touchpoint: anyMeal ? 'any_meal' : 'dinner', cadence: 'daily', per_occurrence: anyMeal,
  fixed, event_timed: false, active: true, why: null,
}));
const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 1, 20, 0);

// Simulate consecutive dinners, recording shown items into state the way the app does.
function simulate(days: number, context = 'normal') {
  mock.timers.enable({ apis: ['Date'], now: T0 });
  try {
    const state = new Map<string, SamplerState>();
    const out: string[][] = [];
    for (let d = 0; d < days; d++) {
      const picked = sampleTouchpoint(items, state, 'dinner', new Set(), context);
      out.push(picked.map((i) => i.item_id));
      for (const i of picked) {
        const s = state.get(i.item_id);
        state.set(i.item_id, { item_id: i.item_id, last_shown_at: new Date(Date.now()).toISOString(), times_shown: (s?.times_shown ?? 0) + 1 });
      }
      mock.timers.tick(DAY);
    }
    return out;
  } finally {
    mock.timers.reset();
  }
}

test('dinner serves the fixed anchors (alcohol first, then dinner composition) plus 5 sampled items', () => {
  const [day1] = simulate(1);
  assert.equal(day1.length, 7);
  assert.deepEqual(day1.slice(0, 2), ['AL1', 'FD1']);
});

test('every non-suppressed dinner item is served within a bounded number of dinners', () => {
  const days = simulate(8);
  const first = new Map<string, number>();
  days.forEach((d, k) => d.forEach((id) => { if (!first.has(id)) first.set(id, k + 1); }));
  const sampled = items.filter((i) => !i.fixed).map((i) => i.item_id);
  for (const id of sampled) assert.ok(first.has(id), `${id} never shown`);
  assert.ok(Math.max(...sampled.map((id) => first.get(id)!)) <= 6, JSON.stringify([...first]));
});

test('rest-day suppression still holds across the rotation', () => {
  const shown = new Set(simulate(8, 'rest').flat());
  assert.ok(!shown.has('AA1') && !shown.has('AA2'));
});

test('the facet holding the stalest item goes first', () => {
  mock.timers.enable({ apis: ['Date'], now: T0 });
  try {
    // Everything shown yesterday except CN2 (shown long ago) and FR1 (never shown), both late in row order.
    const state = new Map<string, SamplerState>();
    for (const i of items) {
      state.set(i.item_id, { item_id: i.item_id, last_shown_at: new Date(T0 - DAY).toISOString(), times_shown: 3 });
    }
    state.set('CN2', { item_id: 'CN2', last_shown_at: new Date(T0 - 30 * DAY).toISOString(), times_shown: 3 });
    state.delete('FR1');
    const ids = sampleTouchpoint(items, state, 'dinner', new Set()).map((i) => i.item_id);
    // After the fixed anchor and the protective pin, the stalest facets lead: never-shown, then 30 days.
    const rest = ids.filter((id) => id !== 'FD1' && id !== 'AL1' && !items.find((i) => i.item_id === id)!.is_protective);
    assert.deepEqual(rest.slice(0, 2), ['FR1', 'CN2']);
  } finally {
    mock.timers.reset();
  }
});

test('the protective pin still holds every dinner', () => {
  for (const day of simulate(8)) {
    const sampled = day.filter((id) => id !== 'FD1' && id !== 'AL1');
    assert.ok(items.some((i) => i.is_protective && sampled.includes(i.item_id)), `no protective item in ${day}`);
    assert.ok(items.find((i) => i.item_id === sampled[0])!.is_protective, 'protective item listed first');
  }
});

test('sampleTouchpoint stays pure: same input, same output, state untouched', () => {
  const state = new Map<string, SamplerState>();
  const a = sampleTouchpoint(items, state, 'dinner', new Set()).map((i) => i.item_id);
  const b = sampleTouchpoint(items, state, 'dinner', new Set()).map((i) => i.item_id);
  assert.deepEqual(a, b);
  assert.equal(state.size, 0);
});

// Lunch after migrations 017–018: the two any_meal questions plus NR4 and SQ3. Lunch and dinner
// share sampler state in the app (dinner also serves NR1/NR2), so simulate both each day.
test('lunch asks one meal question plus one lunch question, and the pair changes day to day', () => {
  const lunchItems: Item[] = [
    ...items,
    ...(['NR4', 'SQ3'] as const).map((item_id) => ({ ...items[0], item_id, facet: item_id === 'SQ3' ? 'quality' : 'regulation',
      is_protective: false, touchpoint: 'lunch' as const, per_occurrence: false, fixed: false })),
  ];
  mock.timers.enable({ apis: ['Date'], now: T0 });
  try {
    const state = new Map<string, SamplerState>();
    const record = (picked: Item[]) => { for (const i of picked) { const s = state.get(i.item_id); state.set(i.item_id, { item_id: i.item_id, last_shown_at: new Date(Date.now()).toISOString(), times_shown: (s?.times_shown ?? 0) + 1 }); } };
    const lunches: string[][] = [];
    for (let d = 0; d < 6; d++) {
      const lunch = sampleTouchpoint(lunchItems, state, 'lunch', new Set());
      lunches.push(lunch.map((i) => i.item_id).sort());
      record(lunch);
      mock.timers.tick(DAY / 4);
      record(sampleTouchpoint(lunchItems, state, 'dinner', new Set()));
      mock.timers.tick(DAY * 3 / 4);
    }
    for (const l of lunches) {
      assert.equal(l.length, 2, `lunch ${l}`);
      assert.equal(l.filter((id) => id === 'NR1' || id === 'NR2').length, 1, `one meal question in ${l}`);
      assert.equal(l.filter((id) => id === 'NR4' || id === 'SQ3').length, 1, `one lunch question in ${l}`);
    }
    for (let d = 1; d < lunches.length; d++) assert.notDeepEqual(lunches[d], lunches[d - 1], `day ${d} repeats day ${d - 1}`);
    assert.deepEqual([...new Set(lunches.flat())].sort(), ['NR1', 'NR2', 'NR4', 'SQ3']);
  } finally {
    mock.timers.reset();
  }
});

// The screen reorders what the sampler returns, so test the order the user actually sees.
test('on screen, dinner opens with "Any alcohol today?" then composition, before the protective pick', () => {
  const state = new Map<string, SamplerState>();
  const shown = sampleTouchpoint(items, state, 'dinner', new Set());
  const ids = orderForCapture(shown, 'dinner').map((i) => i.item_id);
  assert.equal(ids[0], 'AL1');
  assert.equal(ids[1], 'FD1');
  assert.ok(items.find((i) => i.item_id === ids[2])!.is_protective);
  assert.equal(ids.length, shown.length);
});

test('on screen, non-fixed cards go protective-first and morning keeps sampler order', () => {
  const mk = (id: string, p: boolean, fixed = false) => ({ ...items[0], item_id: id, is_protective: p, fixed });
  const shown = [mk('A', false), mk('B', true), mk('C', false, true), mk('D', true)];
  assert.deepEqual(orderForCapture(shown, 'lunch').map((i) => i.item_id), ['C', 'B', 'D', 'A']);
  assert.deepEqual(orderForCapture(shown, 'breakfast').map((i) => i.item_id), ['A', 'B', 'C', 'D']);
});
