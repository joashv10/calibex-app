import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { signedIn } from "@/lib/serverAuth";
import { searchAndRecord } from "@/lib/webLookup";
import { NUTRIENT_KEYS, NUTRIENT_UNITS, PRODUCT_UNITS, perUnitNutrients, verifiedSource } from "@/lib/supplements";

export const runtime = "nodejs";
export const maxDuration = 120; // it searches the web first

// A supplement brand's real label, found by web search (never from memory). A miss, or
// numbers from a page the search didn't return, is { known: false }: the sheet logs without them.
const STR_OR_NULL = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "product", "unit", "serving_units", "nutrients", "source_url", "note"],
  properties: {
    found: { type: "boolean" },
    product: STR_OR_NULL,
    unit: { type: "string", enum: PRODUCT_UNITS },
    serving_units: { type: "number" },
    nutrients: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "amount", "unit"],
        properties: {
          key: { type: "string", enum: NUTRIENT_KEYS },
          label: { type: "string" },
          amount: { type: "number" },
          unit: { type: "string", enum: NUTRIENT_UNITS },
        },
      },
    },
    source_url: STR_OR_NULL,
    note: STR_OR_NULL,
  },
} as const;

export async function POST(req: NextRequest) {
  if (!(await signedIn(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "estimator_unconfigured" }, { status: 503 });

  let body: { name?: string; brand?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  // one line of plain text: a name can't carry instructions into the prompt
  const clean = (v: unknown, n: number) => (typeof v === "string" ? v : "").replace(/[\r\n"`]+/g, " ").trim().slice(0, n);
  const name = clean(body?.name, 60);
  const brand = clean(body?.brand, 80);
  if (brand.length < 2 || name.length < 2) return NextResponse.json({ error: "no_brand" }, { status: 400 });

  const prompt = `Find the nutrition label of this exact supplement product with web search, and record it with the record_label tool.
Supplement: "${name}"
Brand / product as typed: "${brand}"

Rules:
- Search for this brand's product: its official site first, else a retailer listing (HealthKart, Amazon.in, 1mg, iHerb). If you can open the product page (web_fetch), read the label from the page itself; otherwise use the search result that shows the label.
- Copy the label's "per serving" amounts exactly: every vitamin, mineral, caffeine, EPA, DHA and total omega-3 the label lists. serving_units is how many units one serving is (a label saying "serving size 2 tablets" = 2); unit is what one unit is (tablet, caps, scoop, g or ml; a piece of gum, a lozenge or a chewable is a tablet).
- Minerals as the ELEMENTAL amount (magnesium, zinc, calcium, iron). Put the form in note, e.g. "magnesium glycinate, 200 mg elemental". If the page only gives the compound's weight, do not guess the elemental figure: leave that mineral out and say so in note.
- Anything else on the label (curcumin, ashwagandha, probiotics' CFU, amino acids) uses key "other" with its own short label. Use the unit the label uses (mg, mcg, g or IU); skip lines in other units.
- NEVER fill from memory or from what such products usually contain. If no page you opened or searched shows this product's numbers, set found false, nutrients [] and source_url null.
- source_url is the exact address of the page you fetched or searched that the numbers came from. product is that page's product title.
- note: one short line (form of a mineral, "per 2 tablets", anything a reader should double-check), or null.`;

  try {
    const got = await searchAndRecord(prompt, { name: "record_label", description: "Record the supplement's label. Call this exactly once, as the final step.", schema: SCHEMA });
    if (got === "refused") return NextResponse.json({ error: "refused" }, { status: 502 });
    if (!got) return NextResponse.json({ error: "parse_failed" }, { status: 502 });
    const m = got.input as { found?: boolean; product?: string | null; unit?: string; serving_units?: number; nutrients?: unknown; source_url?: string | null; note?: string | null };
    // the page must be one the search returned; a source link made up from memory is a miss
    if (m.found !== true || !m.source_url || !verifiedSource(m.source_url, got.urls)) return NextResponse.json({ known: false });
    const unit = PRODUCT_UNITS.find((u) => u === m.unit);
    const serving = Number(m.serving_units);
    if (!unit || !(serving > 0 && serving <= 100)) return NextResponse.json({ known: false });
    const per_unit = perUnitNutrients(m.nutrients, serving);
    if (per_unit.length === 0) return NextResponse.json({ known: false });
    return NextResponse.json({
      known: true, product: (m.product ?? "").slice(0, 120) || null, unit, per_unit,
      source_url: m.source_url.slice(0, 500), note: (m.note ?? "").slice(0, 200) || null,
    });
  } catch (e) {
    console.error("supplement:", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
    return NextResponse.json({ error: "estimator_error" }, { status: 502 });
  }
}
