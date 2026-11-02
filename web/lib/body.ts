"use client";
import { supabase } from "./supabaseClient";
import { isBackfill, logDate } from "./day";

// ── stool: one tap per bowel movement, form in 3 buckets, timed at the tap ──
// hard = Bristol 1–2, normal = 3–4, loose = 5–7. Backfilled taps store no time.
export type StoolForm = "hard" | "normal" | "loose";
export type Stool = { id: string; form: StoolForm; logged_at: string | null };
export const STOOL_FORMS: { form: StoolForm; label: string; hint: string }[] = [
  { form: "hard", label: "Hard", hint: "lumpy" },
  { form: "normal", label: "Normal", hint: "formed" },
  { form: "loose", label: "Loose", hint: "mushy" },
];

export async function getTodayStool(): Promise<Stool[]> {
  const { data, error } = await supabase.from("stool_log").select("id,form,logged_at")
    .eq("wake_date", logDate()).order("created_at");
  if (error) console.error("stool_log", error);
  return (data as Stool[]) ?? [];
}
export const newStool = (form: StoolForm): Stool =>
  ({ id: crypto.randomUUID(), form, logged_at: isBackfill() ? null : new Date().toISOString() });
export async function logStool(s: Stool) {
  const { error } = await supabase.from("stool_log").insert({ ...s, wake_date: logDate() });
  if (error) throw error;
}
export async function deleteStool(id: string) {
  const { error } = await supabase.from("stool_log").delete().eq("id", id);
  if (error) throw error;
}
