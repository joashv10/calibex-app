import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairWhoop } from '../lib/pairWhoop.ts';
import type { Session, WhoopWorkout } from '../lib/train.ts';

const w = (id: string, start: string, end: string) =>
  ({ id, workout_start: `2026-10-19T${start}:00Z`, workout_end: `2026-10-19T${end}:00Z`, sport_name: 'weightlifting' }) as WhoopWorkout;
const s = (name: string, at: string) =>
  ({ name, sets: 1, volume: 0, entries: [{ entry_id: name, exercise_id: 'x', exercise_name: 'x', tracking_type: 'weight_reps', sets: [], logged_at: `2026-10-19T${at}:00Z` }] }) as unknown as Session;

const am = w('am', '06:00', '07:00'), pm = w('pm', '17:00', '18:00');

test('a session logged inside a workout window pairs with that workout, not the first', () => {
  assert.deepEqual(pairWhoop([s('legs', '17:30')], [am, pm], '2026-10-19').map((x) => x?.id), ['pm']);
});

test('a session logged long after any window takes the first free workout', () => {
  assert.deepEqual(pairWhoop([s('back', '12:00')], [am, pm], '2026-10-19').map((x) => x?.id), ['am']);
});

test('each workout pairs at most once; extra sessions get null', () => {
  const out = pairWhoop([s('a', '06:30'), s('b', '06:40'), s('c', '20:00')], [am, pm], '2026-10-19');
  assert.deepEqual(out.map((x) => x?.id ?? null), ['am', 'pm', null]);
});

test('the +45 min save-after-gym grace counts as inside the window', () => {
  assert.deepEqual(pairWhoop([s('a', '18:44')], [am, pm], '2026-10-19').map((x) => x?.id), ['pm']);
});
