import { NextRequest, NextResponse, after } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { dispatchWorkflow } from "@/lib/github";

export const runtime = "nodejs";

// WHOOP webhook → re-run the WHOOP sync on GitHub Actions within ~1–2 min of a
// recovery / sleep / workout being scored. This route never touches WHOOP data or
// tokens itself: the GitHub workflow stays the ONLY thing that refreshes WHOOP's
// single-use refresh token (its concurrency group serialises runs), so a webhook
// can't break the token chain.
//
// Env (server-only): WHOOP_CLIENT_SECRET (signature key) and GITHUB_DISPATCH_TOKEN
// (fine-grained PAT on this repo with Actions: read & write) and GITHUB_REPO ("owner/name").
// Deletions aren't mirrored (the sync only upserts), so they don't trigger a run.
const SYNC_EVENTS = new Set(["recovery.updated", "sleep.updated", "workout.updated"]);

// WHOOP signs base64(HMAC-SHA256(timestamp header + raw body, client secret)).
function validSignature(raw: string, ts: string, sig: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(ts + raw).digest();
  const given = Buffer.from(sig, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(req: NextRequest) {
  const secret = process.env.WHOOP_CLIENT_SECRET;
  if (!secret || !process.env.GITHUB_DISPATCH_TOKEN) return NextResponse.json({ error: "webhook_unconfigured" }, { status: 503 });

  const raw = await req.text();
  const ts = req.headers.get("x-whoop-signature-timestamp");
  const sig = req.headers.get("x-whoop-signature");
  if (!ts || !sig || !validSignature(raw, ts, sig, secret)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let type = "";
  try { type = (JSON.parse(raw) as { type?: string }).type ?? ""; } catch {}
  if (SYNC_EVENTS.has(type)) {
    // Reply first (WHOOP wants a 2xx within ~1s), dispatch once the response is sent.
    // A failed dispatch is only logged: the every-2-hours schedule is the backstop.
    after(async () => {
      const r = await dispatchWorkflow("nightly.yml", { days: "2" });
      if (r.ok) console.log(`whoop webhook: ${type} → sync dispatched`);
      else console.error(`whoop webhook: dispatch failed ${r.status} ${r.detail}`);
    });
  }
  return new NextResponse(null, { status: 204 });
}
