// Sends one reminder to every live device.
// Run by GitHub Actions (which holds the Supabase service key + VAPID private key),
// dispatched by web/app/api/nudge when private.run_reminders() finds a moment due.
//   node scripts/send-nudge.mjs <morning|lunch|session|dinner|log> [ref]
// Each reminder opens its exact sheet and says what it's for. The "is it still open?"
// checks are repeated here because a minute or two passes between the cron tick and
// this run, and a moment you've just logged must stay silent.
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY, // this GitHub secret holds the SERVICE key (bypasses RLS), same as the nightly sync
  VAPID_PUBLIC,
  VAPID_PRIVATE,
  VAPID_SUBJECT,
} = process.env;

const kind = process.argv[2] || "log";
const ref = process.argv[3] || "";

const DRY = !!process.env.DRY_RUN; // print the message, send nothing
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || (!DRY && (!VAPID_PUBLIC || !VAPID_PRIVATE))) {
  console.error("Missing required env (SUPABASE_URL / SUPABASE_ANON_KEY / VAPID_PUBLIC / VAPID_PRIVATE).");
  process.exit(1);
}

if (!DRY) webpush.setVapidDetails(VAPID_SUBJECT || "mailto:you@example.com", VAPID_PUBLIC, VAPID_PRIVATE);
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const { data: settings } = await sb.from("user_settings").select("tz").eq("id", 1).maybeSingle();
const tz = settings?.tz || "Asia/Kolkata";

// The wake day (4am boundary) in your timezone, and the day before it.
const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
const wd = ymd(new Date(Date.now() - 4 * 3600_000));
const prevDay = (day, n = 1) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const yd = prevDay(wd);
const hhmm = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const exists = async (q) => ((await q.limit(1)).data ?? []).length > 0;

const NOT_SESSIONS = new Set(["walking", "race walking", "activity", "other", "driving", "increase_relaxation", "meditation", "sauna", "ice bath"]);
const sportLabel = (s) => { const t = s.replace(/[-_]/g, " "); return t[0].toUpperCase() + t.slice(1); };
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");

async function morning() {
  if (await exists(sb.from("item_responses").select("id").eq("wake_date", wd).eq("touchpoint", "breakfast"))) return null;
  const sunday = new Date(`${wd}T12:00:00Z`).getUTCDay() === 0;
  const tail = sunday ? " Weekly review + weigh-in today." : "";

  const { data: cyc } = await sb.from("cycles").select("wake_date,recovery_score")
    .gte("wake_date", prevDay(wd, 60)).lte("wake_date", wd).order("wake_date");
  const today = (cyc ?? []).find((c) => c.wake_date === wd && c.recovery_score != null);

  // Yesterday, side by side with this morning's number. No conclusion drawn.
  const facts = [];
  const { data: dinner } = await sb.from("food_log").select("eaten_at").eq("wake_date", yd).eq("slot", "dinner")
    .not("eaten_at", "is", null).order("eaten_at").limit(1);
  if (dinner?.[0]) facts.push(`dinner ${hhmm(dinner[0].eaten_at)}`);
  const { data: alc } = await sb.from("substance_log").select("dose_bucket,alcohol_g").eq("wake_date", yd).eq("substance", "alcohol");
  // same as nightLabel in lib/alcohol.ts: summed grams when every row has them (10 g = 1 drink)
  if (alc?.length) {
    const n = alc.every((a) => a.alcohol_g != null) ? alc.reduce((t, a) => t + Number(a.alcohol_g), 0) / 10 : null;
    const r = n == null ? 0 : n < 3 ? Math.round(n * 10) / 10 : Math.round(n);
    facts.push(n != null ? `≈${r} drink${r === 1 ? "" : "s"}`
      : alc.map((a) => `${a.dose_bucket.replace("-", "–")} drink${a.dose_bucket === "1" ? "" : "s"}`).join(" + "));
  }
  const { data: wos } = await sb.from("workouts").select("sport_name,duration_minutes,workout_start").eq("wake_date", yd);
  const seen = new Set();
  const mins = new Map();
  for (const w of (wos ?? []).filter((w) => w.sport_name === w.sport_name.toLowerCase()).sort((a, b) => a.workout_start.localeCompare(b.workout_start))) {
    const key = w.workout_start.slice(0, 16);
    if (seen.has(key) || NOT_SESSIONS.has(w.sport_name.replace(/-/g, " "))) continue;
    seen.add(key);
    mins.set(w.sport_name, (mins.get(w.sport_name) ?? 0) + Number(w.duration_minutes ?? 0));
  }
  for (const [sp, m] of mins) facts.push(`${sp.replace(/[-_]/g, " ")} ${Math.round(m)} min`);
  const yesterday = facts.length ? `Yesterday: ${facts.join(" · ")}. ` : "";

  if (!today) {
    return { title: "Morning check-in · 4 taps", body: `${yesterday}How hard it was to get up, urine colour, night-time pee, one question about last night.${tail}` };
  }
  const rec = Math.round(today.recovery_score);
  // Your normal = median of the last 28 scored mornings (within 60 days; WHOOP has gaps).
  const prior = (cyc ?? []).filter((c) => c.wake_date < wd && c.recovery_score != null)
    .slice(-28).map((c) => Number(c.recovery_score)).sort((a, b) => a - b);
  const mid = Math.floor(prior.length / 2);
  const normal = prior.length < 7 ? null : prior.length % 2 ? prior[mid] : (prior[mid - 1] + prior[mid]) / 2; // same as the app
  const vs = normal != null ? ` (${signed(Math.round(rec - normal))} vs your normal)` : "";
  return { title: `Recovery ${rec}%${vs}`, body: `${yesterday}Morning check-in: 4 taps.${tail}` };
}

async function lunch() {
  if (await exists(sb.from("food_log").select("id").eq("wake_date", wd).eq("slot", "lunch"))) return null;
  if (await exists(sb.from("meal_skips").select("id").eq("wake_date", wd).eq("slot", "lunch"))) return null;
  return { title: "Lunch · log it in one line", body: "Type what you're eating, or mark lunch skipped.", url: "/food?add=lunch" };
}

async function session() {
  const { data: w } = await sb.from("workouts").select("sport_name,duration_minutes,strain_score,workout_start").eq("id", ref).maybeSingle();
  if (!w || NOT_SESSIONS.has(w.sport_name.toLowerCase().replace(/-/g, " ")) || (w.duration_minutes ?? 0) < 10) return null;
  if (await exists(sb.from("item_responses").select("id").eq("wake_date", wd).eq("touchpoint", "post_workout").gte("answered_at", w.workout_start))) return null;
  const strain = w.strain_score != null ? ` · strain ${Number(w.strain_score).toFixed(1)}` : "";
  return { title: `${sportLabel(w.sport_name)} · ${Math.round(w.duration_minutes ?? 0)} min${strain}`, body: "How hard was it? One tap." };
}

async function dinner() {
  if (await exists(sb.from("item_responses").select("id").eq("wake_date", wd).eq("touchpoint", "dinner"))) return null;
  return { title: "Dinner · evening check-in", body: "Tonight's dinner, then a few quick taps on your day. About a minute." };
}

async function weeklyReview() {
  if (await exists(sb.from("item_responses").select("id").eq("wake_date", wd).eq("touchpoint", "weekly_review"))) return null;
  return { title: "Weekly review · 1 min", body: "6 quick questions and your weigh-in." };
}

const BUILDERS = {
  morning: async () => ({ url: "/?open=morning", ...(await morning() ?? { skip: true }) }),
  lunch: async () => (await lunch()) ?? { skip: true },
  session: async () => ({ url: "/?open=post_workout", ...(await session() ?? { skip: true }) }),
  dinner: async () => ({ url: "/?open=dinner", ...(await dinner() ?? { skip: true }) }),
  weekly_review: async () => ({ url: "/?open=weekly_review", ...(await weeklyReview() ?? { skip: true }) }),
  // Legacy fixed-hour kinds: only until the old cron jobs are unscheduled.
  breakfast: async () => ({ url: "/?open=morning", ...(await morning() ?? { skip: true }) }),
  afternoon: async () => ({ skip: true }),
  weighin: async () => ({ url: "/progress", title: "Weekly weigh-in · 1 number", body: "Weigh yourself before breakfast." }),
  log: async () => ({ url: "/", title: "CALIBEX", body: "Test reminder." }),
};

const msg = await (BUILDERS[kind] ?? BUILDERS.log)();
if (msg.skip) { console.log(`kind=${kind} skipped: already logged or nothing to remind about`); process.exit(0); }
if (DRY) { console.log(JSON.stringify({ kind, wd, ...msg })); process.exit(0); }

const { data: subs, error } = await sb.from("push_subscriptions").select("endpoint,p256dh,auth").is("dead_at", null);
if (error) { console.error("read error:", error.message); process.exit(1); }

const payload = JSON.stringify({ tag: `calibex-${kind}`, url: msg.url || "/", title: msg.title, body: msg.body });

let sent = 0, dead = 0;
for (const s of subs ?? []) {
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
    await sb.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("endpoint", s.endpoint);
    sent++;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      // Marked, not deleted: the phone sees "dead" on its next open and re-subscribes.
      await sb.from("push_subscriptions").update({ dead_at: new Date().toISOString() }).eq("endpoint", s.endpoint);
      dead++;
    } else {
      console.error("send error", e.statusCode, e.body || e.message);
    }
  }
}
console.log(`kind=${kind} wd=${wd} title="${msg.title}" sent=${sent} dead=${dead} total=${subs?.length ?? 0}`);
