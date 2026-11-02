import { NextRequest, NextResponse } from "next/server";
import { signedIn } from "@/lib/serverAuth";
import { guard, refByName, withOil } from "@/lib/foodRef";

export const runtime = "nodejs";

// Estimate per-100g macros for a food via Claude. Key is server-side only.
export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!(await signedIn(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { food?: string; brand?: string; oiliness?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const food = (body.food ?? "").trim();
  if (!food) return NextResponse.json({ error: "no_food" }, { status: 400 });
  const brand = (body.brand ?? "").trim();
  const oiliness = body.oiliness || "normal";
  // A food-table staple never goes to the model: its numbers are fixed, the oil level moves the fat.
  const ref = brand ? null : refByName(food);
  if (ref) return NextResponse.json(withOil(ref, oiliness));
  if (!key) return NextResponse.json({ error: "estimator_unconfigured" }, { status: 503 });

  const prompt = `Estimate the nutrition of this food PER 100 GRAMS, as eaten.
Food: "${food}"${brand ? `\nBrand: "${brand}" — use this exact branded product's nutrition if you know it.` : ""}
Cooking oil/fat level: ${oiliness} (low = minimal oil; normal = typical home cooking; high = restaurant / heavy ghee or oil).

Rules:
- This feeds a quantified-self instrument where OVERESTIMATION IS WORSE THAN UNDERESTIMATION. When unsure, estimate on the LOW side.
- Per 100 g of the edible part: for bone-in food (tandoori chicken, mutton curry), the meat only, bone excluded.
- Cooking oil/ghee is the single biggest accuracy variable — scale the fat with the oil/fat level given.
- Assume typical Indian / South-Indian home preparation unless the name clearly implies otherwise.
- carb_100 = available carbohydrate EXCLUDING fibre; if a label's carbohydrate includes fibre, subtract the fibre. fibre_100 = total dietary fibre. sugar_100 = total sugars. Use null when unknown. Err LOW.
- Output ONLY a compact JSON object, nothing else:
{"kcal_100": <int>, "protein_100": <number>, "carb_100": <number>, "fat_100": <number>, "fibre_100": <number|null>, "sugar_100": <number|null>}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01",
        // Org-level keys (not scoped to a workspace) must name the workspace to bill.
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 2000,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) {
      console.error(`estimate: anthropic ${r.status} ${(await r.text()).slice(0, 300)}`);
      return NextResponse.json({ error: "estimator_error" }, { status: 502 });
    }
    const data = await r.json();
    // thinking may come first: read the text block
    const text: string = (data?.content ?? []).find((b: { type?: string }) => b.type === "text")?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ error: "parse_error" }, { status: 502 });
    const m = JSON.parse(match[0]);
    const num = (v: unknown, hi: number) => Math.min(hi, Math.max(0, Number(v) || 0));
    const numOrNull = (v: unknown, hi: number) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : num(v, hi)); // unknown stays null, never 0
    return NextResponse.json(guard(food, {
      kcal_100: num(m.kcal_100, 900), protein_100: num(m.protein_100, 100),
      carb_100: num(m.carb_100, 100), fat_100: num(m.fat_100, 100),
      fibre_100: numOrNull(m.fibre_100, 100), sugar_100: numOrNull(m.sugar_100, 100),
    }).per100);
  } catch {
    return NextResponse.json({ error: "estimator_error" }, { status: 502 });
  }
}
