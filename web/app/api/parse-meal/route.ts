import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { readMeal, type Photo } from "@/lib/mealReader";
import { signedIn } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const maxDuration = 120; // a brand lookup searches the web first

// Typed meal, screenshot or label → dishes. The reader itself is lib/mealReader.ts.
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "estimator_unconfigured" }, { status: 503 });
  if (!(await signedIn(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let text = "";
  let image: Photo | null = null;
  try {
    const b = (await req.json()) as { text?: string; image?: { data?: string; media_type?: string } };
    text = String(b.text ?? "").trim().slice(0, 400);
    if (b.image?.data && b.image.media_type === "image/jpeg" && b.image.data.length < 4_000_000) image = { data: b.image.data, media_type: "image/jpeg" };
  } catch {}
  if (!text && !image) return NextResponse.json({ error: "no_text" }, { status: 400 });

  try {
    const dishes = await readMeal(text, image);
    if (dishes === "refused") return NextResponse.json({ error: "refused" }, { status: 502 });
    if (!dishes) return NextResponse.json({ error: "parse_failed" }, { status: 502 });
    return NextResponse.json({ dishes });
  } catch (e) {
    console.error("parse-meal:", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
    return NextResponse.json({ error: "parse_failed" }, { status: 502 });
  }
}
