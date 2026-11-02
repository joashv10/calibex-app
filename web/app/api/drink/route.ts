import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { signedIn } from "@/lib/serverAuth";
import { searchAndRecord } from "@/lib/webLookup";
import { verifiedSource } from "@/lib/supplements";

export const runtime = "nodejs";
export const maxDuration = 120; // it searches the web first

// A drink brand's % alc and sugar, found by web search (never from memory). The sheet keeps
// the type's default when nothing is found, so a miss, or a source the search didn't return,
// is { known: false }, never an error the user has to handle.
const NUM_OR_NULL = { anyOf: [{ type: "number" }, { type: "null" }] } as const;
const STR_OR_NULL = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "name", "abv", "carb_100ml", "serve_ml", "source_url"],
  properties: {
    found: { type: "boolean" },
    name: { type: "string" },
    abv: { type: "number" },
    carb_100ml: NUM_OR_NULL,
    serve_ml: NUM_OR_NULL,
    source_url: STR_OR_NULL,
  },
} as const;

export async function POST(req: NextRequest) {
  if (!(await signedIn(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "estimator_unconfigured" }, { status: 503 });

  let body: { brand?: string; type?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  // one line of plain text: a brand can't carry instructions into the prompt
  const clean = (v: unknown, n: number) => (typeof v === "string" ? v : "").replace(/[\r\n"`]+/g, " ").trim().slice(0, n);
  const brand = clean(body?.brand, 80);
  if (brand.length < 2) return NextResponse.json({ error: "no_brand" }, { status: 400 });
  const type = clean(body?.type, 30);

  const prompt = `Find the alcohol content and sugar of this drink with web search, and record it with the record_drink tool.
Drink: "${brand}"${type ? `\nThe user filed it under: ${type}` : ""}

Rules:
- Search for it, then, if you can open the best page (web_fetch), read the numbers from it, otherwise use the search result that shows them: the brand's own site, else a retailer, bar or recipe page. NEVER fill from memory: if no page you opened or searched gives the numbers, set found false and source_url null.
- It is either a BRAND (Fireball, Old Monk, Kingfisher Strong) or a NAMED DRINK / COCKTAIL (Long Island Iced Tea, mojito, sangria, rum and coke, shandy). Both count.
- Brand: abv is the % on the label. If it comes in several strengths, use the one most commonly sold in India; if still unsure between two, the LOWER.
- Named drink / cocktail: cite a recipe page (a bar or recipe site) and work out the whole drink from its recipe: abv is for the whole drink as served (spirits plus mixers, before ice melt); serve_ml is the volume of one drink as served, without ice. When recipes vary, the LOWER alcohol.
- carb_100ml: grams of carbohydrate (sugar) per 100 ml. 0 for plain spirits. null when the page does not say (never guess 0 for a liqueur, cider, beer or cocktail). Liqueurs, flavoured spirits, ciders, breezers and beers have some. This feeds a tracker where overestimating is worse than underestimating: when unsure, err LOW.
- serve_ml: only for a named drink / cocktail; null for a brand.
- name: the short name, e.g. "Fireball Cinnamon Whisky", "Long Island Iced Tea".
- source_url: the exact address of the page the numbers came from (for a cocktail, the recipe page).`;

  try {
    const got = await searchAndRecord(prompt, { name: "record_drink", description: "Record the drink's strength and sugar. Call this exactly once, as the final step.", schema: SCHEMA });
    if (got === "refused") return NextResponse.json({ error: "refused" }, { status: 502 });
    if (!got) return NextResponse.json({ error: "parse_error" }, { status: 502 });
    const m = got.input as { found?: boolean; name?: string; abv?: number; carb_100ml?: number | null; serve_ml?: number | null; source_url?: string | null };
    const abv = Number(m.abv);
    // the same bounds the table enforces (sl_abv_chk); a "known" answer outside them isn't trusted,
    // and neither is one whose page the search never returned
    if (m.found !== true || !(abv > 0 && abv <= 100) || !m.source_url || !verifiedSource(m.source_url, got.urls)) return NextResponse.json({ known: false });
    // null (the page lists no sugar) stays null, so the sheet keeps the type's default; never 0
    const carb = typeof m.carb_100ml === "number" && Number.isFinite(m.carb_100ml) ? Math.min(60, Math.max(0, m.carb_100ml)) : null;
    return NextResponse.json({
      known: true, name: String(m.name || brand).slice(0, 60),
      abv: Math.round(abv * 10) / 10, carb_100ml: carb == null ? null : Math.round(carb * 10) / 10,
      // a cocktail's one-drink size; a value outside a plausible glass is dropped
      serve_ml: Number(m.serve_ml) >= 30 && Number(m.serve_ml) <= 600 ? Math.round(Number(m.serve_ml)) : null,
      source_url: m.source_url.slice(0, 500),
    });
  } catch (e) {
    console.error("drink:", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
    return NextResponse.json({ error: "estimator_error" }, { status: 502 });
  }
}
