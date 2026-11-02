"use client";
import { useRef, useState } from "react";

// One-tap logs (water, stool): the row shows the moment you tap and repeat taps
// stack. Each row's id is made on the client, and local taps and undos are
// overlaid on the fetched rows by id, so a reload landing at any moment (or out
// of order) can't count a tap twice or bring an undone one back. This session's
// taps keep tap order after the older rows, so "undo last" is the last tap.
// Key the component by day so taps never carry over to another day.
export function useTapLog<T extends { id: string }>(fetched: T[], onChange: () => void | Promise<void>) {
  const [taps, setTaps] = useState<T[]>([]);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [undone, setUndone] = useState<Set<string>>(new Set());
  const flying = useRef(0);
  const tapIds = new Set(taps.map((t) => t.id));
  const shown = [...fetched.filter((r) => !tapIds.has(r.id)), ...taps].filter((r) => !undone.has(r.id));
  const without = (set: Set<string>, id: string) => { const n = new Set(set); n.delete(id); return n; };
  // Reload once the last save lands.
  const save = async (f: () => Promise<void>) => {
    flying.current++;
    try { await f(); } catch (e) { console.error(e); }
    if (--flying.current === 0) await Promise.resolve(onChange()).catch(console.error);
  };
  const add = (row: T, insert: (row: T) => Promise<void>) => {
    setTaps((ts) => [...ts, row]); setSaving((s) => new Set(s).add(row.id));
    save(async () => {
      try { await insert(row); }
      catch (e) { setTaps((ts) => ts.filter((t) => t.id !== row.id)); throw e; }
      finally { setSaving((s) => without(s, row.id)); }
    });
  };
  const undo = (id: string, remove: (id: string) => Promise<void>) => {
    setUndone((u) => new Set(u).add(id));
    save(async () => {
      try { await remove(id); }
      catch (e) { setUndone((u) => without(u, id)); throw e; }
    });
  };
  const last = shown[shown.length - 1];
  // Undo waits until its row is saved, so it never deletes before the insert lands.
  return { shown, last, canUndo: !!last && !saving.has(last.id), add, undo };
}
