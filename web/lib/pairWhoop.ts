// Pure (no Supabase import) so node tests can load it; re-exported from lib/train.
import type { Session, WhoopWorkout } from "./train";
// Which WHOOP strength workout each session belongs to, one rule for every screen:
// the workout whose window (start −15 min … end +45 min) holds the session's first
// set, else the first one not yet taken. Each workout pairs at most once.
export function pairWhoop(sessions: Session[], strength: WhoopWorkout[], day: string): (WhoopWorkout | null)[] {
  const used = new Set<string>();
  return sessions.map((s) => {
    const t = Math.min(...s.entries.map((e) => new Date(e.logged_at ?? `${day}T12:00:00`).getTime()));
    const free = strength.filter((w) => !used.has(w.id));
    const inWindow = free.find((w) => {
      const a = new Date(w.workout_start).getTime(), b = new Date(w.workout_end ?? w.workout_start).getTime();
      return t >= a - 15 * 60000 && t <= b + 45 * 60000;
    });
    const w = inWindow ?? free[0] ?? null;
    if (w) used.add(w.id);
    return w;
  });
}
