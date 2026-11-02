import { useSyncExternalStore } from 'react';
import { cachedSettings, toMin } from './settings';

// The shared day-boundary rule (READOUT_SPEC.md): a tap before 4am belongs to
// the previous waking day, so dinner-at-11pm and can't-sleep-at-1:30am land on
// the same wake_date. Device-local time.
export function wakeDate(now: Date = new Date()): string {
  const d = new Date(now);
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Which meal moment it is now: highlights what's due on Today and pre-slots the food
// logger. Follows your own lunch and dinner times once they're set; fixed hours before.
export function currentTouchpoint(now: Date = new Date()): string {
  const s = cachedSettings();
  const L = toMin(s?.lunch), D = toMin(s?.dinner);
  if (L != null && D != null) {
    const rel = (x: number) => (x - 240 + 1440) % 1440; // minutes since 04:00, the day boundary
    const r = rel(now.getHours() * 60 + now.getMinutes()), l = rel(L), d = rel(D);
    if (r < l - 60) return 'breakfast';
    if (r < (l + d) / 2) return 'lunch';
    if (r < d - 60) return 'afternoon';
    return 'dinner';
  }
  const h = now.getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 18) return 'afternoon';
  return 'dinner';
}

// ── Selected day: today, or any past day picked from the calendar ──────────
// Every read/write of logged data goes through logDate(). The pick lives in module
// memory only, so a cold open always starts on today; it also drops back to today
// after 30 min in the background. Any day can be VIEWED, but only today and the
// EDIT_DAYS before it can be EDITED (canEdit): older recall is unreliable. Backfilled rows
// stay identifiable: their created_at / answered_at is the real entry time.
let picked: string | null = null; // null = today
let version = 0;
const listeners = new Set<() => void>();

export function yesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return wakeDate(d);
}

export function logDate(): string { return picked ?? wakeDate(); }

export function setLogDay(day: string | null) {
  const next = !day || day >= wakeDate() ? null : day;
  if (next === picked) return;
  picked = next;
  version++;
  listeners.forEach((f) => f());
}

// Re-renders the caller whenever the picked day changes; returns the day in view.
export function useLogDay(): string {
  useSyncExternalStore(
    (f) => { listeners.add(f); return () => { listeners.delete(f); }; },
    () => version,
    () => 0,
  );
  return logDate();
}

export function isBackfill(): boolean { return logDate() !== wakeDate(); }
// Today plus this many days back take new entries and edits.
export const EDIT_DAYS = 5;
export function oldestEditable(): string {
  const d = new Date();
  d.setDate(d.getDate() - EDIT_DAYS);
  return wakeDate(d);
}
export function canEdit(day: string = logDate()): boolean { return day <= wakeDate() && day >= oldestEditable(); }

// "today" / "yesterday" / "Thu 12 Sep" — for labels like "kcal today".
export function dayWord(day: string = logDate()): string {
  if (day === wakeDate()) return 'today';
  if (day === yesterdayDate()) return 'yesterday';
  const d = new Date(`${day}T12:00:00`);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
}
export function dayTitle(day: string = logDate()): string {
  const w = dayWord(day);
  return w[0].toUpperCase() + w.slice(1);
}

if (typeof document !== 'undefined') {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (picked && Date.now() - hiddenAt > 30 * 60_000) setLogDay(null);
  });
}

// A clock time ("HH:MM") on a wake day, honouring the 4am boundary: 00:00–03:59
// belongs to the night after that day. Without this, an 11pm dinner logged at
// 12:30am was stamped 22h in the future.
export function atTime(day: string, hhmm: string): Date {
  const [hh, mm] = hhmm.split(':').map((n) => parseInt(n, 10));
  const d = new Date(`${day}T12:00:00`);
  if (Number.isFinite(hh) && Number.isFinite(mm)) d.setHours(hh, mm, 0, 0);
  if (d.getHours() < 4) d.setDate(d.getDate() + 1);
  return d;
}
