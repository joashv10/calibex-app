import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dispatchWorkflow } from "@/lib/github";

export const runtime = "nodejs";

// Reminder trigger. Supabase pg_cron runs private.run_reminders() every 5 minutes;
// when a moment is due (WHOOP scored your sleep, 30 min into lunch, a workout was
// scored, 30 min into dinner) it posts here via pg_net, and this starts nudge.yml,
// which holds the VAPID key and sends the push. GitHub's own schedule ran 4–6h late,
// so the clock lives in Postgres and GitHub only does the sending.
//
// Env (server-only): NUDGE_SECRET (shared with the Vault secret "nudge_secret"
// that the cron jobs send as x-nudge-secret) and GITHUB_DISPATCH_TOKEN.
const KINDS = new Set(["morning", "lunch", "session", "dinner", "log", "weekly_review",
  "breakfast", "afternoon", "weighin"]); // legacy fixed-hour kinds, kept until the old cron jobs are gone

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: NextRequest) {
  const secret = process.env.NUDGE_SECRET;
  if (!secret) return NextResponse.json({ error: "nudge_unconfigured" }, { status: 503 });
  if (!sameSecret(req.headers.get("x-nudge-secret") ?? "", secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let touchpoint = "", ref = "";
  try {
    const b = (await req.json()) as { touchpoint?: string; ref?: string | null };
    touchpoint = b.touchpoint ?? "";
    ref = typeof b.ref === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.ref) ? b.ref : ""; // a workouts.id
  } catch {}
  // "sync": private.run_sync_catchup() saw no recovery for today yet (the WHOOP webhook didn't
  // come and GitHub's schedule runs hours late), so pull the last 2 days from WHOOP now.
  if (touchpoint === "sync") {
    const s = await dispatchWorkflow("nightly.yml", { days: "2" });
    if (!s.ok) {
      console.error(`nudge: sync dispatch failed ${s.status} ${s.detail}`);
      return NextResponse.json({ error: "dispatch_failed", status: s.status }, { status: 502 });
    }
    return NextResponse.json({ dispatched: "sync" }, { status: 202 });
  }
  if (!KINDS.has(touchpoint)) return NextResponse.json({ error: "bad_touchpoint" }, { status: 400 });

  // Only send `ref` when there is one: GitHub rejects inputs the workflow doesn't declare.
  const r = await dispatchWorkflow("nudge.yml", ref ? { touchpoint, ref } : { touchpoint });
  if (!r.ok) {
    console.error(`nudge: dispatch failed ${r.status} ${r.detail}`);
    return NextResponse.json({ error: "dispatch_failed", status: r.status }, { status: 502 });
  }
  return NextResponse.json({ dispatched: touchpoint }, { status: 202 });
}
