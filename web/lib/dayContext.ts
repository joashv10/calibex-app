// Day context: a quiet flag for travel / sick / rest days. A missing row means a
// normal day (getDayContext defaults to it), so "Normal day" deletes the row.
export type DayContext = 'normal' | 'travel' | 'sick' | 'rest';

export const CONTEXT_OPTIONS: { id: Exclude<DayContext, 'normal'>; label: string; why: string }[] = [
  { id: 'travel', label: 'Travel', why: "Left out of your patterns (sleep and recovery are off for reasons that aren't you)" },
  { id: 'sick', label: 'Sick', why: 'Left out of your patterns, and no training questions' },
  { id: 'rest', label: 'Rest', why: 'Planned rest: no training questions' },
];

export function isDayContext(v: unknown): v is DayContext {
  return v === 'normal' || v === 'travel' || v === 'sick' || v === 'rest';
}

// The text of the quiet link under the timeline.
export function contextLinkText(ctx: string): { lead: string; action: string } {
  const o = CONTEXT_OPTIONS.find((x) => x.id === ctx);
  return o ? { lead: `${o.label} day`, action: 'change' } : { lead: '', action: 'Travel, sick or rest day?' };
}
