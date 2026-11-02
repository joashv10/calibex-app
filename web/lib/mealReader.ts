import Anthropic from "@anthropic-ai/sdk";
import { BOWLS, OFF_TABLE_PIECES, REFS, resolveDish, type RawDish } from "./foodRef";

// The meal reader, server-only. "penne alfredo, 1 plate + a coke", a screenshot
// of a delivery app's listed macros, or a pack label → dishes with a portion,
// gram weights for small / regular / large, and per-100 g macros. The client
// scales macros by the chosen portion locally, so switching portions never needs
// another call. A named brand may trigger a web search for its label. The answer
// comes back through the strict record_dishes tool rather than a JSON response
// format, because web search always carries citations, which that format rejects.
// Key is server-side only (ANTHROPIC_API_KEY, a Default-workspace key).



const NUM = { type: "number" } as const;
const NUM_OR_NULL = { anyOf: [{ type: "number" }, { type: "null" }] } as const; // null = unknown (anyOf: the form the structured-outputs docs show)
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dishes"],
  properties: {
    dishes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["food", "portion", "grams_small", "grams_regular", "grams_large", "kcal_100", "protein_100", "carb_100", "fat_100", "fibre_100", "sugar_100", "cooked", "dose_mg", "caffeine_100", "source", "basis", "ref", "count", "size", "drink", "out", "grams_said", "unit", "unit_g"],
        properties: {
          food: { type: "string" },
          portion: { type: "string", enum: ["small", "regular", "large"] },
          grams_small: NUM, grams_regular: NUM, grams_large: NUM,
          kcal_100: NUM, protein_100: NUM, carb_100: NUM, fat_100: NUM, fibre_100: NUM_OR_NULL, sugar_100: NUM_OR_NULL,
          cooked: { type: "boolean" },
          dose_mg: NUM, caffeine_100: NUM,
          source: { type: "string", enum: ["estimate", "label", "web"] },
          basis: { type: "string" },
          ref: { type: "string", enum: ["", ...REFS.map((r) => r.key)] },
          count: NUM,
          size: { type: "string", enum: ["", ...BOWLS.map((b) => b.label)] },
          drink: { type: "boolean" },
          out: { type: "boolean" },
          grams_said: NUM,
          unit: { type: "string" },
          unit_g: NUM,
        },
      },
    },
  },
} as const;

// One line per table food, for the prompt: "roti: Roti (piece: 1 roti)", "dal: Dal (bowl)".
const REF_LINES = REFS.map((r) => `- ${r.key}: ${r.name} (${r.serve.kind === "piece" ? `piece: 1 ${r.serve.unit}` : "bowl"})`).join("\n");

const PROMPT = (text: string, photo: boolean) => `Someone logging their meal in a quantified-self nutrition instrument ${photo
  ? `sent the attached image: a screenshot of a dish's listed nutrition (from a delivery or grocery app), a pack label, or similar.${text ? ` They also typed: """${text}"""` : ""}`
  : `typed: """${text}"""`}

Split it into the separate dishes and drinks they had, and record them with the record_dishes tool. For each:
- food: a short clean name, title case, no quantities (e.g. "Penne Alfredo", "Masala Dosa", "Coca-Cola"). For a branded product keep the brand and the variant they named, since variants differ: "SuperU Protein Bar (20g Protein)", not "Protein Bar".
- portion: the size they described. "1 plate", "a bowl", "a glass" or nothing = regular; "a little", "half" = small; "a lot", "2 plates" = large.
- grams_small / grams_regular / grams_large: realistic weights for that dish at each size, as served. When they give a count ("2 idli", "3 rotis"), make grams_regular that count's weight. For drinks, grams ≈ ml. Bone-in dishes (tandoori or roast chicken, chicken legs, mutton/fish curry with bone, ribs): grams are the EDIBLE part only, never the weight with bone. A half tandoori chicken is ~350 g on the plate but ~200 g of meat.
- kcal_100, protein_100, carb_100, fat_100: nutrition per 100 g as eaten (edible part, bone excluded), with typical oil for home cooking.
- carb_100 = available carbohydrate EXCLUDING fibre; if a label's carbohydrate includes fibre, subtract the fibre. fibre_100 = total dietary fibre. sugar_100 = total sugars. Use null when unknown. Err LOW.
- cooked: true if it is cooked with oil, ghee or butter (curries, fried, sautéed, pasta sauces); false for drinks, raw fruit, plain bread, boiled items, and packaged foods.
- dose_mg: only for a pure caffeine product taken as a dose (caffeine pill or tablet, caffeine gum, a caffeine shot): its total caffeine in mg, as stated ("200mg caffeine pill" = 200, "2 caffeine pills" = 2 × a typical pill). If no dose is given, use the most common dose for that product, erring low. 0 for everything else.
- caffeine_100: caffeine in mg per 100 g (or ml) of a food or drink as served: brewed coffee ~40, espresso ~210, chai ~20, cola ~10, energy drinks ~32. 0 when there is none or only a trace. 0 for a dose product (use dose_mg).
- source: "label" when the numbers come from the image or from numbers they stated, "web" when from a web search, "estimate" otherwise.
- basis: one short line on where the numbers came from, so they can check it at a glance: "label: per 100 g × 260 g serving", "label: per bar (40 g)", "superu.in: per bar", "estimate". For a bone-in dish: "estimate · meat only, no bone". Lowercase, no full stop.

Everyday dishes in the food table. If a dish is one of these, set ref to its key (else ""):
${REF_LINES}
- count: for a piece food (marked "piece"), the number they said ("2 roti" = 2, "a dosa" = 1, "half a paratha" = 0.5); 0 if they gave no number. For an egg dish, the number of eggs. Never guess a count.
- size: for a bowl food (marked "bowl"), the size they said: "katori" (a small bowl, a cup), "bowl", or "plate" (a full plate, a big helping); "" if they didn't say. Never guess a size.
- grams_said: the grams (or ml) they stated for THIS dish ("200g chicken fry" = 200, "about 250g rice" = 250); 0 if they gave no weight. A count is not a weight.
- unit, unit_g: for a food NOT in the table that is eaten in pieces (${OFF_TABLE_PIECES.join(", ")}...): unit = the piece name, singular ("cookie"), and unit_g = one typical piece's weight in grams, erring low; "" and 0 for everything else. For these, count is the number they said (0 if not said). Never guess a count.
- Combo plates: when one size covers a rice combo ("1 plate rajma chawal", "a plate of dal rice", "curd rice plate"), split it into its dishes: rice size "bowl", the curry or dal size "katori". Never give each part its own plate.
- For a ref'd dish the app sets the grams and numbers from the table; fill the other fields with your best values anyway.
- out: true only if they said the food was from outside: a restaurant, hotel, darshini, canteen, cafe, dhaba, Swiggy/Zomato, "ordered", takeaway, delivery, "ate out". Home food, or not said: false.
- drink: true for anything you drink (tea, coffee, juice, milk, soft drinks, alcohol, water), else false.

Labels and listed nutrition (images, or numbers they typed):
- Find the basis before anything else: per 100 g, per serving, or per pack. Read the small print. Only call it per 100 g when the image says so ("per 100 g", "/100g"). Delivery apps (Swiggy, Zomato) show "Nutritional Value" or "Macros" for the whole dish, beside its "Serving Size": those numbers are per serving.
- Check the basis with energy density: listed kcal ÷ serving grams × 100. Real meals land around 80–250 kcal per 100 g (fried snacks and sweets up to ~550). If reading the numbers as per 100 g would make the dish implausible (a 440 g rice bowl at 2300 kcal), they are per serving.
- Convert to per 100 g. When the label is per serving or per pack, divide by that serving's weight in grams. If the weight isn't shown, use the product's typical weight and say so in basis.
- Your per-100 g numbers × grams_regular ÷ 100 must give back the label's own numbers for that serving (protein, carbs, fat, kcal), except that carbs exclude the label's fibre (below). Never blend label numbers with your own estimate: if any label number is missing, estimate only that one, low.
- grams_regular = one serving or pack as shown (the "serves 1" weight). grams_small = half of it, grams_large = two of it.
- Copy the label's numbers exactly. Don't adjust them toward low. The one exception is carbs: labels (Indian and US) count fibre inside carbohydrate, so when the label lists dietary fibre, carb_100 = label carbohydrate − label fibre, and fibre_100 = the label's fibre. When it lists no fibre, keep its carbohydrate and set fibre_100 null. sugar_100 = the label's total sugars, or null if not listed.

Branded or packaged products (a brand name, a pack, a bar, a bottle, a protein powder):
- One unit means one pack, bar, bottle or scoop. grams_regular is that unit's weight; grams_small = half a unit, grams_large = two units. portion: regular for one unit, large for two.
- Any number they state ("20g protein version", "250 kcal") is a fact about the product: match it exactly. Never read it as the portion weight unless they say grams eaten.
- If you don't know this exact product's label, use web search to find it: the brand's site, or a grocery or delivery listing for that variant. Search only for branded products; never for home-cooked or restaurant dishes. If searching doesn't settle it, estimate the missing macros low and set source "estimate".

Rules:
- OVERESTIMATION IS WORSE THAN UNDERESTIMATION: errors compound in the analysis. When estimating, go to the low end for both weights and macros. (Label numbers are copied as they are.)
- Assume Indian / South-Indian home preparation for home-style dishes, unless the dish clearly implies otherwise. Packaged foods follow their label.
- If there is no food or drink, record an empty dishes list.`;

const RECORD: Anthropic.Beta.BetaTool = {
  name: "record_dishes",
  description: "Record the dishes and drinks in the meal. Call this exactly once, as the final step.",
  strict: true,
  input_schema: SCHEMA as unknown as Anthropic.Beta.BetaTool.InputSchema,
};
// Fallback if the API ever rejects the nullable fields: the same tool without fibre/sugar
// (they come back missing, which resolveDish reads as unknown), so logging never breaks on them.
const PLAIN_ITEM = (() => {
  const it = SCHEMA.properties.dishes.items;
  const { fibre_100: _f, sugar_100: _s, ...properties } = it.properties; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...it, properties, required: it.required.filter((k) => k !== "fibre_100" && k !== "sugar_100") };
})();
// Set once the API rejects the nullable fields: later reads on this server instance skip them.
let plainSchema = false;
const RECORD_PLAIN: Anthropic.Beta.BetaTool = {
  ...RECORD,
  input_schema: { ...SCHEMA, properties: { dishes: { ...SCHEMA.properties.dishes, items: PLAIN_ITEM } } } as unknown as Anthropic.Beta.BetaTool.InputSchema,
};
const SEARCH: Anthropic.Beta.BetaWebSearchTool20260209 = { type: "web_search_20260209", name: "web_search", max_uses: 3, allowed_callers: ["direct"] };

const client = new Anthropic({
  // Org-level keys must name a workspace; Default-workspace keys don't need this.
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined,
});


export type Photo = { data: string; media_type: "image/jpeg" };

export async function readMeal(text: string, image: Photo | null) {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{
    role: "user",
    content: [
      ...(image ? [{ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: image.data } }] : []),
      { type: "text" as const, text: PROMPT(text, !!image) },
    ],
  }];
  const ask = (tools: Anthropic.Beta.BetaToolUnion[]) => client.beta.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // a declined request re-runs on Anthropic's recommended fallback
    output_config: { effort: "low" },
    tools,
    tool_choice: { type: "auto" },
    messages,
  });
  let r: Anthropic.Beta.BetaMessage | null = null;
  let used: Anthropic.Beta.BetaToolUnion[] = [SEARCH, plainSchema ? RECORD_PLAIN : RECORD];
  try {
    // A long server-side search loop can pause; resume it (three calls at most).
    for (let i = 0; i < 3; i++) {
      r = await ask(used);
      if (r.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: r.content });
    }
  } catch (e) {
    // Logging must never break: a rejected request is either the search or the nullable
    // fibre/sugar fields. Try without the fields first (keeps the search), then without the
    // search, then without both; remember a rejected schema for later reads on this instance.
    if (!(e instanceof Anthropic.BadRequestError)) throw e;
    console.error("meal reader: request rejected, retrying:", e.message);
    messages.splice(1);
    const tries: Anthropic.Beta.BetaToolUnion[][] = plainSchema ? [[RECORD_PLAIN]] : [[SEARCH, RECORD_PLAIN], [RECORD], [RECORD_PLAIN]];
    for (const [n, t] of tries.entries()) {
      try { r = await ask(t); used = t; break; } catch (e2) {
        if (!(e2 instanceof Anthropic.BadRequestError) || n === tries.length - 1) throw e2;
      }
    }
    if (used.includes(RECORD_PLAIN) && !plainSchema) {
      plainSchema = true;
      console.error("meal reader: schema rejected, reading without fibre/sugar from now on");
    }
  }
  if (!r || r.stop_reason === "refusal") return "refused" as const;
  const recorded = (m: Anthropic.Beta.BetaMessage) => m.content.find((b) => b.type === "tool_use" && b.name === "record_dishes");
  let call = recorded(r);
  if (!call && r.stop_reason === "end_turn") {
    // It answered in prose instead of recording: ask once more, with the record tool required.
    messages.push({ role: "assistant", content: r.content }, { role: "user", content: "Record them now with record_dishes." });
    r = await ask(used); // same tools that just worked; Sonnet 5.5 rejects a forced tool_choice, the message above steers it
    if (r.stop_reason === "refusal") return "refused" as const;
    call = recorded(r);
  }
  if (!call || call.type !== "tool_use") return null;
  const parsed = call.input as { dishes?: RawDish[] };
  return (parsed.dishes ?? []).slice(0, 8).map(resolveDish);
}
