// Quick picks under the food box: only what you've had at this meal, most often first,
// then most recent. Shawaya at dinner never shows up at breakfast. Pure, for tests.
export function slotPicks<T extends { food: string; slot: string | null }>(rows: T[], slot: string, limit = 8): T[] {
  // rows come newest first; the newest row per food carries the grams you last had
  const by = new Map<string, { row: T; n: number; i: number }>();
  rows.forEach((r, i) => {
    if (r.slot !== slot) return;
    const k = r.food.trim().toLowerCase();
    const e = by.get(k);
    if (e) e.n += 1; else by.set(k, { row: r, n: 1, i });
  });
  return [...by.values()].sort((a, b) => b.n - a.n || a.i - b.i).slice(0, limit).map((e) => e.row);
}
