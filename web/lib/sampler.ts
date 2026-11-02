// Least-recently-served, facet-stratified sampler with a protective pin.
// See SAMPLER_SPEC.md. Pure function — no I/O.
import type { Item,SamplerState, Touchpoint } from './types';

// Morning = 3 fixed (out of bed, urine colour, night pee) + 1 from the "last night" pool.
const QUOTA: Record<string, number> = {
  breakfast: 1, lunch: 2, afternoon: 3, post_workout: 1, dinner: 5,
};
const MEAL_TPS = new Set(['breakfast', 'lunch', 'afternoon', 'dinner']);
// Cap on 'any_meal' questions at a touchpoint; the rest of its quota rotates through its own
// pool. Lunch asks one of the two meal questions plus one lunch question (migration 017),
// so it no longer serves the same pair every day.
const MEAL_SLOTS: Record<string, number> = { lunch: 1 };
const FIXED_ORDER = ['SQ1', 'HY2', 'SM3', 'AL1', 'FD1', 'RPE1'];
const PROTECTIVE_PIN = new Set(['dinner']);
const SUPPRESS: Record<string, string[]> = {
  rest: ['AA1', 'AA2', 'AS1', 'AS2', 'RPE1'],
  sick: ['AA1', 'AA2', 'AS1', 'AS2', 'RPE1'],
  travel: [],
  normal: [],
};

export function sampleTouchpoint(
  allItems: Item[],
  state: Map<string, SamplerState>,
  tp: Touchpoint,
  answeredToday: Set<string>,
  context = 'normal',
): Item[] {
  if (tp === 'weekly_review') {
    return allItems.filter((i) => i.active && i.touchpoint === 'weekly_review');
  }

  const suppressed = new Set(SUPPRESS[context] || []);
  const pool = allItems.filter(
    (i) =>
      i.active &&
      (i.touchpoint === tp || (i.touchpoint === 'any_meal' && MEAL_TPS.has(tp))) &&
      !suppressed.has(i.item_id) &&
      (i.per_occurrence || !answeredToday.has(i.item_id)),
  );

  // Fixed anchors in a set order (morning: out of bed, then urine colour), not DB row order.
  const rank = (i: Item) => { const k = FIXED_ORDER.indexOf(i.item_id); return k < 0 ? 99 : k; };
  const fixed = pool.filter((i) => i.fixed).sort((a, b) => rank(a) - rank(b) || a.item_id.localeCompare(b.item_id));
  let cands = pool.filter((i) => !i.fixed);
  const quota = QUOTA[tp] ?? 3;

  const staleness = (i: Item) => {
    const s = state.get(i.item_id);
    if (!s || !s.last_shown_at) return Infinity;
    return Date.now() - new Date(s.last_shown_at).getTime();
  };
  const stalerFirst = (a: Item, b: Item) => {
    const sa = staleness(a), sb = staleness(b);
    if (sa !== sb) return sb > sa ? 1 : -1; // never-shown (Infinity) first; avoids Infinity - Infinity = NaN
    const ta = state.get(a.item_id)?.times_shown ?? 0;
    const tb = state.get(b.item_id)?.times_shown ?? 0;
    return ta - tb;
  };
  const lrs = (arr: Item[]) => arr.slice().sort(stalerFirst);

  const selected: Item[] = [];

  // Protective pin (dinner): reserve a slot for the stalest protective item.
  if (PROTECTIVE_PIN.has(tp)) {
    const prot = lrs(cands.filter((i) => i.is_protective));
    if (prot.length) {
      selected.push(prot[0]);
      cands = cands.filter((i) => i.item_id !== prot[0].item_id);
    }
  }

  // Meal-question cap: the stalest any_meal items fill their slots, the rest leave the pool.
  if (MEAL_SLOTS[tp] != null) {
    const meal = lrs(cands.filter((i) => i.touchpoint === 'any_meal')).slice(0, MEAL_SLOTS[tp]);
    selected.push(...meal);
    cands = cands.filter((i) => i.touchpoint !== 'any_meal');
  }

  // Fill remaining slots: facet round-robin + LRS within facet.
  const byFacet = new Map<string, Item[]>();
  for (const i of cands) {
    const f = i.facet || i.dimension_id;
    if (!byFacet.has(f)) byFacet.set(f, []);
    byFacet.get(f)!.push(i);
  }
  for (const f of byFacet.keys()) byFacet.set(f, lrs(byFacet.get(f)!));
  // Start the round-robin at the facet whose stalest item has waited longest, so with
  // quota < facets every facet gets its turn instead of the first rows always winning.
  const facets = Array.from(byFacet.keys()).sort((a, b) =>
    stalerFirst(byFacet.get(a)![0], byFacet.get(b)![0]));
  let fi = 0;
  while (selected.length < quota) {
    let placed = false;
    for (let k = 0; k < facets.length; k++) {
      const list = byFacet.get(facets[(fi + k) % facets.length])!;
      if (list.length) {
        selected.push(list.shift()!);
        fi = (fi + k + 1) % facets.length;
        placed = true;
        break;
      }
    }
    if (!placed) break;
  }

  // Order: fixed anchors first, then protective-first among the sampled.
  const sampledOrdered = selected
    .slice()
    .sort((a, b) => (b.is_protective ? 1 : 0) - (a.is_protective ? 1 : 0));
  return [...fixed, ...sampledOrdered];
}

// Card order on screen. Morning keeps the sampler's fixed order. Elsewhere the fixed anchors
// (dinner: alcohol, then composition) stay in front, then a positive question opens the rest.
export function orderForCapture(shown: Item[], tp: Touchpoint): Item[] {
  if (tp === 'breakfast') return shown.slice();
  const fixed = shown.filter((i) => i.fixed);
  const rest = shown.filter((i) => !i.fixed);
  return [...fixed, ...rest.filter((i) => i.is_protective), ...rest.filter((i) => !i.is_protective)];
}

// The afternoon check-in is gone from Today (you wake ~10:50, so it landed barely
// after breakfast); its questions now live in the dinner pool (migration 016).
export const TOUCHPOINTS: { id: Touchpoint; label: string }[] = [
  { id: 'breakfast', label: 'Morning check-in' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'post_workout', label: 'After a workout' },
  { id: 'dinner', label: 'Dinner' },
];
