'use client';
import { supabase } from './supabaseClient';

// Your schedule and reminder switches. One row in user_settings (id = 1), so they
// survive iOS wiping the web app's storage. The localStorage copy is only a fast
// first paint; the database row always wins.
export type Settings = {
  name: string | null;
  tz: string;
  first_meal: string | null; // 'HH:MM:SS'
  lunch: string | null;
  dinner: string | null;
  remind_morning: boolean;
  remind_lunch: boolean;
  remind_session: boolean;
  remind_dinner: boolean;
  remind_weekly?: boolean; // undefined until migration 022 adds the column; then it is never sent
  setup_done_at: string | null;
  finding_revealed: string | null;
  bottle_ml: number; // your water bottle, for "Add a bottle"
};

const KEY = 'calibex_settings';
let cache: Settings | null = null;

function readLocal(): Settings | null {
  try { const s = localStorage.getItem(KEY); return s ? (JSON.parse(s) as Settings) : null; } catch { return null; }
}
function writeLocal(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export function cachedSettings(): Settings | null {
  if (!cache && typeof window !== 'undefined') cache = readLocal();
  return cache;
}

export async function getSettings(): Promise<Settings | null> {
  const { data, error } = await supabase.from('user_settings').select('*').eq('id', 1).maybeSingle();
  if (error) { console.error(error); return cachedSettings(); }
  cache = (data as Settings | null) ?? null;
  if (cache) writeLocal(cache);
  return cache;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const next = { ...(cache ?? {}), ...patch } as Settings;
  cache = next;
  writeLocal(next);
  const { error } = await supabase.from('user_settings')
    .upsert({ id: 1, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw error;
}

// 'HH:MM[:SS]' ↔ minutes since midnight.
export function toMin(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map((n) => parseInt(n, 10));
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}
export function toHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
// 24h → '10:50' / '9:05 pm' style for prose.
export function clock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
}

// Median wake time over the last 30 WHOOP nights, in local minutes since midnight.
export function usualWake(sleepEnds: (string | null)[], tz: string): number | null {
  const cutoff = Date.now() - 30 * 86400_000;
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const mins = sleepEnds
    .filter((s): s is string => !!s && new Date(s).getTime() > cutoff)
    .map((s) => { const [h, m] = fmt.format(new Date(s)).split(':').map(Number); return h * 60 + m; })
    .sort((a, b) => a - b);
  if (mins.length < 5) return null;
  return mins[Math.floor(mins.length / 2)];
}

// Starting suggestions relative to wake-up, rounded to 15 min. Only a prefill.
export function suggestTimes(wake: number | null): { first_meal: string; lunch: string; dinner: string } {
  const w = wake ?? 8 * 60;
  const r = (m: number) => Math.round(m / 15) * 15;
  return {
    first_meal: toHHMM(r(w + 60)),
    lunch: toHHMM(r(w + 4 * 60)),
    dinner: toHHMM(Math.min(r(w + 10 * 60 + 30), 22 * 60 + 30)),
  };
}
