'use client';
import { supabase } from './supabaseClient';
import { Dimension, Item, ReadoutRow, SamplerState } from './types';
import { logDate, wakeDate } from './day';

// RLS lets only the owner's signed-in session read or write (008_owner_rls.sql).
// AuthGate keeps pages unmounted until that session exists, so this only trips
// if it dies mid-use; AuthGate then hears SIGNED_OUT and shows sign-in.
export async function ensureAuth() {
  const { data } = await supabase.auth.getSession();
  if (!data.session || data.session.user.is_anonymous) throw new Error("signed_out");
}

export async function getItems(): Promise<Item[]> {
  const { data, error } = await supabase.from('items').select('*').eq('active', true);
  if (error) throw error;
  return data as Item[];
}

export async function getDimensions(): Promise<Dimension[]> {
  const { data, error } = await supabase.from('dimensions').select('*').order('sort_order');
  if (error) throw error;
  return data as Dimension[];
}

export async function getSamplerState(): Promise<Map<string, SamplerState>> {
  const { data, error } = await supabase.from('item_sampler_state').select('*');
  if (error) throw error;
  const m = new Map<string, SamplerState>();
  (data || []).forEach((s) => m.set((s as SamplerState).item_id, s as SamplerState));
  return m;
}

export async function getTodayResponses(): Promise<Set<string>> {
  const { data } = await supabase
    .from('item_responses')
    .select('item_id')
    .eq('wake_date', logDate());
  return new Set((data || []).map((r) => (r as { item_id: string }).item_id));
}

export async function getTouchpointStatus(): Promise<Record<string, boolean>> {
  const { data } = await supabase
    .from('item_responses')
    .select('touchpoint')
    .eq('wake_date', logDate());
  const done: Record<string, boolean> = {};
  (data || []).forEach((r) => {
    const tp = (r as { touchpoint: string | null }).touchpoint;
    if (tp) done[tp] = true;
  });
  return done;
}

// Per-touchpoint completion today: how many of the items you went through you
// actually answered. Drives the "X% done" readout on each touchpoint row.
export async function getTouchpointProgress(): Promise<Record<string, { answered: number; total: number }>> {
  const { data } = await supabase
    .from('item_responses')
    .select('touchpoint,status')
    .eq('wake_date', logDate());
  const m: Record<string, { answered: number; total: number }> = {};
  (data || []).forEach((row) => {
    const r = row as { touchpoint: string | null; status: string };
    if (!r.touchpoint) return;
    if (!m[r.touchpoint]) m[r.touchpoint] = { answered: 0, total: 0 };
    m[r.touchpoint].total += 1;
    if (r.status === 'answered') m[r.touchpoint].answered += 1;
  });
  return m;
}

export async function getDayContext(): Promise<string> {
  const { data } = await supabase
    .from('day_context')
    .select('context')
    .eq('wake_date', logDate())
    .maybeSingle();
  return (data as { context: string } | null)?.context || 'normal';
}

// Missing row = normal day, so clearing deletes it. The sampler reads this on load.
export async function setDayContext(context: string): Promise<void> {
  const day = logDate();
  const { error } = context === 'normal'
    ? await supabase.from('day_context').delete().eq('wake_date', day)
    : await supabase.from('day_context').upsert({ wake_date: day, context, updated_at: new Date().toISOString() }, { onConflict: 'wake_date' });
  if (error) throw error;
}

export async function recordShown(itemIds: string[], state: Map<string, SamplerState>) {
  const now = new Date().toISOString();
  const rows = itemIds.map((id) => ({
    item_id: id,
    last_shown_at: now,
    times_shown: (state.get(id)?.times_shown ?? 0) + 1,
    updated_at: now,
  }));
  await supabase.from('item_sampler_state').upsert(rows);
}

export async function saveResponse(r: {
  itemId: string;
  occurrence?: number;
  rawValue: string | null;
  rawJson?: unknown;
  severity: number | null;
  status: 'answered' | 'skipped' | 'na';
  touchpoint: string;
  eventAt?: string | null;
}) {
  const now = new Date().toISOString();
  await supabase.from('item_responses').upsert(
    {
      wake_date: logDate(),
      item_id: r.itemId,
      occurrence: r.occurrence ?? 1,
      raw_value: r.rawValue,
      raw_json: r.rawJson ?? null,
      severity: r.severity,
      status: r.status,
      touchpoint: r.touchpoint,
      event_at: r.eventAt ?? null,
      answered_at: now, // real tap time — a backfilled answer's is after its wake day
      updated_at: now,
    },
    { onConflict: 'wake_date,item_id,occurrence' },
  );
}

// For per_occurrence items (post-workout / per-meal), count today's existing rows so a
// second session appends occurrence 2, 3… instead of overwriting the first.
// Returns item_id -> count-of-rows-today; the next occurrence is that count + 1.
export async function getTodayOccurrences(itemIds: string[]): Promise<Record<string, number>> {
  if (itemIds.length === 0) return {};
  const { data } = await supabase.from('item_responses')
    .select('item_id').eq('wake_date', logDate()).in('item_id', itemIds);
  const m: Record<string, number> = {};
  for (const row of (data ?? []) as { item_id: string }[]) m[row.item_id] = (m[row.item_id] ?? 0) + 1;
  return m;
}

export type RecoveryRow = {
  wake_date: string;
  recovery_score: number | null;
  hrv_rmssd_ms: number | null;
  resting_heart_rate: number | null;
  day_strain: number | null;
  sleep_performance_percent: number | null;
};

export async function getRecovery(days = 14): Promise<RecoveryRow[]> {
  const { data, error } = await supabase
    .from('cycles')
    .select('wake_date,recovery_score,hrv_rmssd_ms,resting_heart_rate,day_strain,sleep_performance_percent')
    .order('wake_date', { ascending: false })
    .limit(days);
  if (error) console.error(error);
  return ((data as RecoveryRow[]) || []).reverse();
}

export async function getReadout(days = 7): Promise<ReadoutRow[]> {
  const { data } = await supabase
    .from('v_readout')
    .select('*')
    .order('behaviour_date', { ascending: false })
    .limit(days);
  return (data as ReadoutRow[]) || [];
}

export async function getDaysLogged(): Promise<number> {
  const { data } = await supabase.from('item_responses').select('wake_date');
  return new Set((data || []).map((r) => (r as { wake_date: string }).wake_date)).size;
}

export async function saveSubstance(
  substance: 'alcohol' | 'caffeine',
  doseBucket: string,
  amount?: number,
) {
  await supabase.from('substance_log').insert({
    wake_date: logDate(),
    substance,
    dose_bucket: doseBucket,
    amount: amount ?? null,
    consumed_at: new Date().toISOString(),
  });
}

export type WeighIn = { wake_date: string; value: number; measured_at: string };
export async function getWeighIns(limit = 8): Promise<WeighIn[]> {
  const { data } = await supabase.from('body_measurements').select('wake_date,value,measured_at')
    .eq('metric', 'weight').order('measured_at', { ascending: false }).limit(limit);
  return ((data ?? []) as { wake_date: string; value: unknown; measured_at: string }[])
    .map((r) => ({ wake_date: r.wake_date, value: Number(r.value), measured_at: r.measured_at }));
}

// Today's weigh-in (same wake_date the upsert uses), so the prompt asks once a day.
export async function getTodayWeight(): Promise<number | null> {
  const { data } = await supabase.from('body_measurements').select('value')
    .eq('wake_date', wakeDate()).eq('metric', 'weight').maybeSingle();
  return data ? Number((data as { value: unknown }).value) : null;
}

export async function saveMeasurement(metric: 'weight' | 'waist', value: number, unit: string) {
  await supabase.from('body_measurements').upsert(
    { wake_date: wakeDate(), metric, value, unit, measured_at: new Date().toISOString() },
    { onConflict: 'wake_date,metric' },
  );
}


// Days in [from, to] with anything logged: the calendar's dots.
export async function getLoggedDays(from: string, to: string): Promise<Set<string>> {
  const tables = ['item_responses', 'food_log', 'lift_log', 'substance_log', 'supplements', 'meal_skips'];
  const res = await Promise.all(tables.map((t) =>
    supabase.from(t).select('wake_date').gte('wake_date', from).lte('wake_date', to)));
  const days = new Set<string>();
  for (const r of res) for (const row of (r.data ?? []) as { wake_date: string }[]) days.add(row.wake_date);
  return days;
}

// One day's WHOOP cycle, for the hero when looking at a past day.
export async function getCycle(day: string): Promise<RecoveryRow | null> {
  const { data } = await supabase
    .from('cycles')
    .select('wake_date,recovery_score,hrv_rmssd_ms,resting_heart_rate,day_strain,sleep_performance_percent')
    .eq('wake_date', day)
    .maybeSingle();
  return (data as RecoveryRow | null) ?? null;
}
