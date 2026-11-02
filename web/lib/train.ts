"use client";
import { supabase } from "./supabaseClient";
import { logDate } from "./day";
import { exerciseById, type TrackingType } from "./exercises";
import { pairWhoop } from "./pairWhoop";
export { pairWhoop };

export type LiftSet = { weight: number | null; reps: number | null; duration_sec: number | null };
export type LiftEntry = {
  entry_id: string;
  exercise_id: string;
  exercise_name: string;
  tracking_type: TrackingType;
  sets: LiftSet[];
  logged_at?: string;
  session_name?: string | null;
};
export type LiftTemplate = { id: string; name: string; exercises: { id: string; name: string; type: TrackingType }[] };
export type WhoopWorkout = {
  id: string; wake_date: string; sport_name: string; duration_minutes: number | null;
  distance_meters: number | null; average_heart_rate: number | null; max_heart_rate: number | null;
  strain_score: number | null; calories_burned: number | null; workout_start: string; workout_end: string | null;
  zone_one_percent: number | null; zone_two_percent: number | null; zone_three_percent: number | null;
  zone_four_percent: number | null; zone_five_percent: number | null;
};

type LiftRow = {
  id: string; wake_date: string; entry_id: string; exercise_id: string; exercise_name: string;
  tracking_type: TrackingType; set_index: number; weight: number | null; reps: number | null;
  duration_sec: number | null; logged_at: string; session_name: string | null;
};

const WCOLS = "id,wake_date,sport_name,duration_minutes,distance_meters,average_heart_rate,max_heart_rate,strain_score,calories_burned,workout_start,workout_end,zone_one_percent,zone_two_percent,zone_three_percent,zone_four_percent,zone_five_percent";

// The workouts table carries a legacy double-import (capitalized sports with
// +5:30-corrupted timestamps) plus same-minute auto-detect twins ("other" next
// to "weightlifting"). Every read filters through this — never trust raw rows.
export function cleanWorkouts<T extends { sport_name: string; workout_start: string }>(rows: T[]): T[] {
  const lower = rows.filter((w) => w.sport_name === w.sport_name.toLowerCase());
  const byMinute = new Map<string, T>();
  for (const w of lower) {
    const key = w.workout_start.slice(0, 16); // minute resolution
    const prev = byMinute.get(key);
    // prefer the specifically-named sport over WHOOP's generic "other" twin
    if (!prev || (prev.sport_name === "other" && w.sport_name !== "other")) byMinute.set(key, w);
  }
  return [...byMinute.values()].sort((a, b) => a.workout_start.localeCompare(b.workout_start));
}

// Group flat set-rows into per-exercise entries; sets ordered, entries by log time.
function groupRows(rows: LiftRow[]): LiftEntry[] {
  const by = new Map<string, LiftRow[]>();
  for (const r of rows) {
    if (!by.has(r.entry_id)) by.set(r.entry_id, []);
    by.get(r.entry_id)!.push(r);
  }
  const entries: LiftEntry[] = [];
  for (const group of by.values()) {
    group.sort((a, b) => a.set_index - b.set_index);
    const f = group[0];
    entries.push({
      entry_id: f.entry_id, exercise_id: f.exercise_id, exercise_name: f.exercise_name,
      tracking_type: f.tracking_type, logged_at: f.logged_at, session_name: f.session_name,
      // Postgres returns `numeric` as a string — coerce here so weight is a real
      // number end-to-end (kills the "9" > "100" lexical-comparison trap downstream).
      sets: group.map((r) => ({
        weight: r.weight == null ? null : Number(r.weight),
        reps: r.reps == null ? null : Number(r.reps),
        duration_sec: r.duration_sec == null ? null : Number(r.duration_sec),
      })),
    });
  }
  // entry_id tiebreak → deterministic order when two entries share logged_at.
  return entries.sort((a, b) =>
    (a.logged_at ?? "").localeCompare(b.logged_at ?? "") || a.entry_id.localeCompare(b.entry_id));
}

export async function getTodayEntries(): Promise<LiftEntry[]> {
  const { data } = await supabase.from("lift_log").select("*").eq("wake_date", logDate())
    .order("logged_at").order("entry_id").order("set_index");
  return groupRows((data as LiftRow[]) ?? []);
}

// Most recent PRIOR-day session of an exercise → the per-set prefill (the set
// you're trying to beat). Excludes today so re-adding mid-session doesn't echo
// what you just logged.
export async function lastSession(exerciseId: string): Promise<LiftEntry | null> {
  const { data: recent } = await supabase.from("lift_log").select("entry_id,logged_at")
    .eq("exercise_id", exerciseId).lt("wake_date", logDate())
    .order("logged_at", { ascending: false }).limit(1);
  const entryId = (recent?.[0] as { entry_id: string } | undefined)?.entry_id;
  if (!entryId) return null;
  const { data } = await supabase.from("lift_log").select("*").eq("entry_id", entryId);
  return groupRows((data as LiftRow[]) ?? [])[0] ?? null;
}

// Distinct exercises ordered by how recently used — the picker's fast lane.
export async function getRecents(limit = 12): Promise<string[]> {
  const { data } = await supabase.from("lift_log").select("exercise_id,logged_at")
    .order("logged_at", { ascending: false }).limit(400);
  const seen: string[] = [];
  for (const r of (data ?? []) as { exercise_id: string }[]) {
    if (!seen.includes(r.exercise_id)) seen.push(r.exercise_id);
    if (seen.length >= limit) break;
  }
  return seen;
}

export async function getFavorites(): Promise<string[]> {
  const { data } = await supabase.from("exercise_favorites").select("exercise_id");
  return ((data ?? []) as { exercise_id: string }[]).map((r) => r.exercise_id);
}
export async function toggleFavorite(exerciseId: string, on: boolean) {
  if (on) await supabase.from("exercise_favorites").upsert({ exercise_id: exerciseId });
  else await supabase.from("exercise_favorites").delete().eq("exercise_id", exerciseId);
}

type EntryInput = Omit<LiftEntry, "entry_id" | "logged_at" | "session_name">;

function toRows(entries: EntryInput[], session_name: string) {
  const wake_date = logDate();
  return entries.flatMap((e) => {
    const entry_id = crypto.randomUUID();
    return e.sets.map((s, i) => ({
      wake_date, session_name, entry_id, exercise_id: e.exercise_id, exercise_name: e.exercise_name,
      tracking_type: e.tracking_type, set_index: i,
      weight: s.weight, reps: s.reps, duration_sec: s.duration_sec,
    }));
  });
}

// Log a whole workout in ONE insert — all-or-nothing, so a mid-session failure
// can't leave half the exercises written. Throws on error (caller surfaces it).
export async function logEntries(entries: EntryInput[], sessionName: string) {
  const rows = toRows(entries, sessionName);
  if (!rows.length) return;
  const { error } = await supabase.from("lift_log").insert(rows);
  if (error) throw error;
}

export async function logEntry(e: EntryInput, sessionName = autoSessionName([e])) {
  return logEntries([e], sessionName);
}

// ── Sessions: a day's lifts shown as one named workout ─────────────────────
// Routines keep their own name ("Back Day"); anything else is named from what it
// trained, e.g. "Back & shoulders" (top two muscle groups by exercise count).
const MUSCLE_GROUP: Record<string, string> = {
  "middle back": "back", lats: "back", "lower back": "back", traps: "back",
  chest: "chest", shoulders: "shoulders", neck: "shoulders",
  biceps: "arms", triceps: "arms", forearms: "arms",
  quadriceps: "legs", hamstrings: "legs", glutes: "legs", calves: "legs", adductors: "legs", abductors: "legs",
  abdominals: "core",
};
export function autoSessionName(entries: { exercise_id: string }[]): string {
  const n: Record<string, number> = {};
  for (const e of entries) {
    const groups = new Set((exerciseById(e.exercise_id)?.pm ?? []).map((m) => MUSCLE_GROUP[m] ?? m));
    groups.forEach((g) => { n[g] = (n[g] ?? 0) + 1; });
  }
  const top = Object.entries(n).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g);
  if (!top.length) return "Strength session";
  const name = top.join(" & ");
  return name[0].toUpperCase() + name.slice(1);
}

export const UNNAMED = "Strength session"; // lifts logged before sessions had names

export type Session = { name: string; entries: LiftEntry[]; sets: number; volume: number };
export function groupSessions(entries: LiftEntry[]): Session[] {
  const by = new Map<string, LiftEntry[]>();
  for (const e of entries) {
    const k = e.session_name || UNNAMED;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(e);
  }
  return [...by.entries()].map(([name, es]) => ({
    name, entries: es,
    sets: es.reduce((t, e) => t + e.sets.length, 0),
    volume: es.reduce((t, e) => t + entryVolume(e), 0),
  }));
}


export async function renameSession(day: string, from: string, to: string) {
  const q = supabase.from("lift_log").update({ session_name: to }).eq("wake_date", day);
  const { error } = await (from === UNNAMED ? q.is("session_name", null) : q.eq("session_name", from));
  if (error) throw error;
}

export async function deleteEntry(entryId: string) {
  const { error } = await supabase.from("lift_log").delete().eq("entry_id", entryId);
  if (error) throw error;
}

export async function getTemplates(): Promise<LiftTemplate[]> {
  const { data } = await supabase.from("lift_templates").select("*").order("created_at", { ascending: false });
  return (data as LiftTemplate[]) ?? [];
}
export async function saveTemplate(name: string, exercises: LiftTemplate["exercises"]) {
  const { error } = await supabase.from("lift_templates").insert({ name, exercises });
  if (error) throw error;
}

// Append exercises to an existing routine (dedup by id) — "this is part of my chest day".
export async function addToTemplate(id: string, exercises: LiftTemplate["exercises"]) {
  const { data } = await supabase.from("lift_templates").select("exercises").eq("id", id).single();
  const existing = (data?.exercises as LiftTemplate["exercises"]) ?? [];
  const have = new Set(existing.map((e) => e.id));
  const merged = [...existing, ...exercises.filter((e) => !have.has(e.id))];
  const { error } = await supabase.from("lift_templates").update({ exercises: merged }).eq("id", id);
  if (error) throw error;
}

// ── Recent workouts: CALIBEX strength sessions + WHOOP, one list ──────────────
// A lift session merges with the WHOOP strength workout it happened inside (same
// window, or same day when the lifts were logged later), so one gym visit is one
// card: your sets + WHOOP's strain. Everything else WHOOP recorded gets its own card.
export const STRENGTH_SPORTS = new Set(["weightlifting", "powerlifting", "functional-fitness"]);
const NOT_WORKOUTS = new Set(["driving", "increase_relaxation"]);

export type WorkoutCard = {
  key: string; day: string; sort: string; title: string;
  whoop: WhoopWorkout | null;
  lifts: { exercises: number; sets: number; volume: number } | null;
};

export async function getRecentWorkouts(days = 30, limit = 16): Promise<WorkoutCard[]> {
  const d = new Date(); d.setDate(d.getDate() - days);
  const from = d.toISOString().slice(0, 10);
  const [liftQ, wQ] = await Promise.all([
    supabase.from("lift_log").select("wake_date,session_name,entry_id,exercise_id,tracking_type,weight,reps,duration_sec,set_index,logged_at,exercise_name,id").gte("wake_date", from),
    supabase.from("workouts").select(WCOLS).gte("wake_date", from),
  ]);
  const whoop = cleanWorkouts(((wQ.data as WhoopWorkout[]) ?? []).filter((w) => !NOT_WORKOUTS.has(w.sport_name)));
  const rows = (liftQ.data as LiftRow[]) ?? [];
  const byDay = new Map<string, LiftRow[]>();
  for (const r of rows) { if (!byDay.has(r.wake_date)) byDay.set(r.wake_date, []); byDay.get(r.wake_date)!.push(r); }

  const cards: WorkoutCard[] = [];
  const used = new Set<string>();
  for (const [day, dayRows] of byDay) {
    const sessions = groupSessions(groupRows(dayRows));
    const paired = pairWhoop(sessions, whoop.filter((w) => w.wake_date === day && STRENGTH_SPORTS.has(w.sport_name)), day);
    for (const [i, s] of sessions.entries()) {
      const t = Math.min(...s.entries.map((e) => new Date(e.logged_at ?? `${day}T12:00:00`).getTime()));
      const w = paired[i];
      if (w) used.add(w.id);
      cards.push({
        key: `lift-${day}-${s.name}`, day, sort: w?.workout_start ?? new Date(t).toISOString(), title: s.name, whoop: w,
        lifts: { exercises: s.entries.length, sets: s.sets, volume: s.volume },
      });
    }
  }
  for (const w of whoop) {
    if (used.has(w.id) || (w.duration_minutes ?? 0) < 5) continue;
    cards.push({ key: w.id, day: w.wake_date, sort: w.workout_start, title: sportLabel(w.sport_name), whoop: w, lifts: null });
  }
  return cards.sort((a, b) => b.sort.localeCompare(a.sort)).slice(0, limit);
}

export function sportLabel(s: string): string {
  const t = s.replace(/[-_]/g, " ");
  return t === "other" || t === "activity" ? "Activity" : t[0].toUpperCase() + t.slice(1);
}

// ── Cardio / runs pulled straight from WHOOP ───────────────────────────────
// eq (not ilike) — the capitalized "Running" rows are the corrupt legacy import.
export async function getRuns(limit = 20): Promise<WhoopWorkout[]> {
  const { data } = await supabase.from("workouts").select(WCOLS)
    .eq("sport_name", "running").gt("distance_meters", 100)
    .order("wake_date", { ascending: false }).limit(limit);
  return cleanWorkouts((data as WhoopWorkout[]) ?? []).sort((a, b) => b.workout_start.localeCompare(a.workout_start));
}
export async function getTodayWorkouts(): Promise<WhoopWorkout[]> {
  const { data } = await supabase.from("workouts").select(WCOLS).eq("wake_date", logDate()).order("workout_start");
  return cleanWorkouts((data as WhoopWorkout[]) ?? []);
}

// Pace, with a sanity cap — WHOOP occasionally logs GPS-broken workouts that
// compute to absurd paces; show nothing rather than a fake 39:11/km.
export function pace(w: WhoopWorkout): string | null {
  if (!w.distance_meters || !w.duration_minutes || w.distance_meters < 100) return null;
  const minPerKm = w.duration_minutes / (w.distance_meters / 1000);
  if (minPerKm > 15 || minPerKm < 2) return null;
  const m = Math.floor(minPerKm), s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}
export function km(w: WhoopWorkout): string {
  return w.distance_meters ? `${(w.distance_meters / 1000).toFixed(2)} km` : "";
}

// ── Derived metrics ────────────────────────────────────────────────────────
// Epley estimated 1-rep max, capped where the formula holds.
export function est1rm(weight: number | null, reps: number | null): number | null {
  if (!weight || !reps) return null;
  return Math.round(weight * (1 + Math.min(reps, 12) / 30));
}
export function bestE1rm(e: LiftEntry): number | null {
  let best: number | null = null;
  for (const s of e.sets) {
    const v = est1rm(s.weight, s.reps);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}
export function entryVolume(e: LiftEntry): number {
  return e.sets.reduce((t, s) => t + (s.weight ?? 0) * (s.reps ?? 0), 0);
}

// One-line summary of an entry's sets — collapses identical sets to "3 × 5 @100".
export function summarizeSets(e: LiftEntry): string {
  if (e.tracking_type === "hold") {
    return e.sets.map((s) => (s.duration_sec ? `${s.duration_sec}s` : "–")).join(" · ");
  }
  const parts = e.sets.map((s) => {
    const reps = s.reps ?? "–";
    if (e.tracking_type === "bodyweight") return s.weight ? `+${s.weight}×${reps}` : `${reps}`;
    return `${s.weight ?? "–"}×${reps}`;
  });
  if (parts.length > 1 && parts.every((p) => p === parts[0])) return `${parts.length} × ${parts[0]}`;
  return parts.join(" · ");
}

// The right-hand readout for a logged entry, by tracking type.
export function tonnage(e: LiftEntry): string | null {
  if (e.tracking_type === "hold") {
    const tot = e.sets.reduce((t, s) => t + (s.duration_sec ?? 0), 0);
    return tot ? `${tot}s total` : null;
  }
  if (e.tracking_type === "bodyweight") {
    const reps = e.sets.reduce((t, s) => t + (s.reps ?? 0), 0);
    return reps ? `${reps} reps` : null;
  }
  const e1 = bestE1rm(e);
  return e1 ? `e1RM ${e1}` : null;
}

export function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
