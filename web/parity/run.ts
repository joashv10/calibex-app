// Meal-reader parity test: a fixed set of meals with sourced reference calories, run
// through the REAL meal reader (and the drink lookup for cocktails) on the live app,
// scored the way the logger would log them. Run it before and after any prompt or
// model change so "it reads Indian food better" is a number.
//
//   CALIBEX_TOKEN=<access token> npm run parity [-- --only id1,id2] [--tol 15] [--base URL] [--meals file] [--out dir] [--prev report.json]
//
// The token is a signed-in Supabase access token (localStorage *-auth-token on the app).
// Every run spends real Anthropic credits: about one model call per meal.
// Read-only: /api/parse-meal and /api/drink log nothing.
import fs from "node:fs";
import path from "node:path";
import { alcoholG, carbG, drinkKcal } from "../lib/alcohol.ts";

type Ref = {
  id: string; text: string; kind?: "meal" | "drink";
  ref_g?: number | null; ref_ml?: number | null; ref_kcal: number; ref_protein_g?: number | null;
  source: string; url?: string; confidence: "high" | "medium" | "low"; note?: string;
};
type Dish = {
  food: string; portion: "small" | "regular" | "large"; grams: Record<string, number>;
  per100: { kcal_100: number; protein_100: number }; pick?: { unit: string; opts: { label: string; g: number }[]; i: number } | null;
  ask?: boolean; source?: string;
};

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const BASE = arg("base") ?? process.env.BASE;
if (!BASE) { console.error("Set --base <url> or the BASE env var to the deployed app to test."); process.exit(1); }
const TOL = Number(arg("tol") ?? 15);
const ONLY = arg("only")?.split(",");
const TOKEN = process.env.CALIBEX_TOKEN;
if (!TOKEN) { console.error("Set CALIBEX_TOKEN (see the header of parity/run.ts)."); process.exit(1); }

const dir = import.meta.dirname;
const OUT = arg("out") ?? path.join(dir, "reports");
const refs: Ref[] = JSON.parse(fs.readFileSync(arg("meals") ?? path.join(dir, "meals.json"), "utf8"))
  .filter((r: Ref) => !ONLY || ONLY.includes(r.id));

const post = async (route: string, body: unknown) => {
  const r = await fetch(`${BASE}${route}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(150_000),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// What the logger would save for one dish with no taps: the table's pick, else the reader's portion.
const gramsOf = (d: Dish) => (d.pick ? d.pick.opts[d.pick.i].g : d.grams[d.portion]);

async function score(r: Ref) {
  const t0 = Date.now();
  if (r.kind === "drink") {
    const { status, body } = await post("/api/drink", { brand: r.text, type: "cocktail" });
    if (status !== 200 || !body.known) return { pred: null, status, detail: body.known === false ? "unknown drink" : JSON.stringify(body).slice(0, 120), ms: Date.now() - t0, ask: false };
    const ml = body.serve_ml ?? r.ref_ml ?? 0;
    const pred = drinkKcal(alcoholG(ml, body.abv), carbG(ml, body.carb_100ml));
    return { pred, protein: 0, status, detail: `${body.name}: ${ml} ml, ${body.abv}% alc, ${body.carb_100ml} g sugar/100 ml`, ms: Date.now() - t0, ask: false };
  }
  const { status, body } = await post("/api/parse-meal", { text: r.text });
  const dishes: Dish[] = body.dishes ?? [];
  if (status !== 200 || !dishes.length) return { pred: null, status, detail: body.error ?? "no dishes", ms: Date.now() - t0, ask: false };
  let kcal = 0, protein = 0;
  const parts = dishes.map((d) => {
    const g = gramsOf(d) ?? 0;
    const k = (d.per100.kcal_100 * g) / 100;
    kcal += k; protein += ((d.per100.protein_100 ?? 0) * g) / 100;
    const how = d.pick ? `${d.pick.opts[d.pick.i].label} ${d.pick.unit}`.trim() : d.portion;
    return `${d.food} (${how}, ${Math.round(g)} g, ${Math.round(k)} kcal${d.source === "table" ? ", table" : ""})`;
  });
  return { pred: Math.round(kcal), protein: Math.round(protein), status, detail: parts.join(" + "), ms: Date.now() - t0, ask: dishes.some((d) => d.ask) };
}

// a few at a time: fast enough, gentle on rate limits
const results: (Ref & Awaited<ReturnType<typeof score>> & { err: number | null; match: boolean })[] = [];
const queue = [...refs];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let r = queue.shift(); r; r = queue.shift()) {
    let s: Awaited<ReturnType<typeof score>>;
    try { s = await score(r); } catch (e) { s = { pred: null, status: 0, detail: String(e).slice(0, 120), ms: 0, ask: false }; }
    const err = s.pred == null ? null : Math.round(((s.pred - r.ref_kcal) / r.ref_kcal) * 1000) / 10;
    results.push({ ...r, ...s, err, match: err != null && Math.abs(err) <= TOL });
    console.error(`${err == null ? "ERR " : Math.abs(err) <= TOL ? "ok  " : "MISS"} ${r.id}: ref ${r.ref_kcal} → ${s.pred ?? "—"} kcal (${err ?? s.detail}${err != null ? "%" : ""})`);
  }
}));
results.sort((a, b) => refs.findIndex((r) => r.id === a.id) - refs.findIndex((r) => r.id === b.id));

// The headline counts only references we trust (high or medium confidence); low-confidence
// ones (composed plates, calorie-app values, implausible source densities) are shown but
// don't move the number, so a better reader can't look worse because of a bad reference.
const trusted = results.filter((r) => r.confidence !== "low");
const scored = trusted.filter((r) => r.err != null);
const errs = scored.map((r) => r.err!);
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const lowScored = results.filter((r) => r.confidence === "low" && r.err != null);
// Split by whether the amount was stated: a change that only helps answered questions
// ("asks size" meals get a chip tap in the app) must not look like a better first read.
const split = (rows: typeof scored) => ({
  meals: rows.length, match_rate: pct(rows.filter((r) => r.match).length, rows.length),
  median_abs_err: med(rows.map((r) => Math.abs(r.err!))),
});
const summary = {
  when: new Date().toISOString(), base: BASE, tol: TOL, meals: results.length, trusted: trusted.length,
  match_rate: pct(scored.filter((r) => r.match).length, trusted.length),
  median_abs_err: med(errs.map(Math.abs)),
  mean_signed_err: errs.length ? Math.round((errs.reduce((a, b) => a + b, 0) / errs.length) * 10) / 10 : null,
  over: scored.filter((r) => r.err! > TOL).length, under: scored.filter((r) => r.err! < -TOL).length,
  failed: results.filter((r) => r.err == null).length,
  stated: split(scored.filter((r) => !r.ask)), asks_size: split(scored.filter((r) => r.ask)),
  low_conf_match_rate: pct(lowScored.filter((r) => r.match).length, results.filter((r) => r.confidence === "low").length),
};
const worst = [...scored].sort((a, b) => Math.abs(b.err!) - Math.abs(a.err!)).slice(0, 3);

// Like-for-like against the previous report: both runs scored on the meals the previous run
// trusted, and every reference whose confidence or kcal changed is named. A reference fixed
// after seeing a run can still be right, but it must never move the headline unannounced.
type Prev = { summary: { when: string }; results: (Ref & { err: number | null; match: boolean })[] };
const prevFile = arg("prev") ?? (fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(OUT, f)).pop() : undefined);
const prev: Prev | null = prevFile ? JSON.parse(fs.readFileSync(prevFile, "utf8")) : null;
const onSet = (rows: { id: string; err: number | null; match: boolean }[], ids: Set<string>) => {
  const r = rows.filter((x) => ids.has(x.id) && x.err != null);
  return { meals: r.length, match_rate: pct(r.filter((x) => x.match).length, r.length), median_abs_err: med(r.map((x) => Math.abs(x.err!))) };
};
const prevIds = new Set((prev?.results ?? []).filter((r) => r.confidence !== "low" && results.some((x) => x.id === r.id)).map((r) => r.id));
const compare = prev ? {
  against: path.basename(prevFile!), set: "meals the previous run trusted, still in this run",
  previous: onSet(prev.results, prevIds), now: onSet(results, prevIds),
  ref_changes: results.flatMap((r) => {
    const p = prev.results.find((x) => x.id === r.id);
    if (!p) return [`${r.id}: new`];
    const c = [p.confidence !== r.confidence && `confidence ${p.confidence} → ${r.confidence}`, p.ref_kcal !== r.ref_kcal && `kcal ${p.ref_kcal} → ${r.ref_kcal}`].filter(Boolean);
    return c.length ? [`${r.id}: ${c.join(", ")}`] : [];
  }).concat(prev.results.filter((p) => !results.some((r) => r.id === p.id)).map((p) => `${p.id}: removed`)),
} : null;

const stamp = summary.when.slice(0, 16).replace(/[:T]/g, "-");
const md = [
  `# Meal-reader parity · ${summary.when.slice(0, 16).replace("T", " ")} UTC`,
  "",
  `**Match rate ${summary.match_rate}%** within ±${TOL}% kcal on ${trusted.length} trusted references (high/medium confidence) · median |error| ${summary.median_abs_err}% · mean signed ${summary.mean_signed_err}% (+ = reads high) · ${summary.over} over, ${summary.under} under · ${summary.failed} failed (all meals)`,
  "",
  `Amount stated: ${summary.stated.match_rate}% within ±${TOL}% (${summary.stated.meals} meals, median |error| ${summary.stated.median_abs_err}%) · asks size: ${summary.asks_size.match_rate}% (${summary.asks_size.meals} meals, median |error| ${summary.asks_size.median_abs_err}%, read at the default with no tap)`,
  "",
  `Low-confidence references (${results.length - trusted.length}, indicative only): ${summary.low_conf_match_rate}% within ±${TOL}%.`,
  "",
  ...(compare ? [
    `Like for like vs ${compare.against} (${compare.now.meals} meals the previous run trusted): ${compare.previous.match_rate}% → ${compare.now.match_rate}% within ±${TOL}% · median |error| ${compare.previous.median_abs_err}% → ${compare.now.median_abs_err}%`,
    "",
    `References changed since then: ${compare.ref_changes.length ? compare.ref_changes.join("; ") : "none"}`,
    "",
  ] : []),
  `Worst trusted: ${worst.map((w) => `${w.id} (${w.err! > 0 ? "+" : ""}${w.err}%)`).join(", ")}`,
  "",
  "| Meal | Ref kcal | Read kcal | Error | Ref conf. | What it logged |",
  "|---|---|---|---|---|---|",
  ...results.map((r) => `| ${r.text} | ${r.ref_kcal} | ${r.pred ?? "—"} | ${r.err == null ? "failed" : `${r.err > 0 ? "+" : ""}${r.err}%${r.match ? "" : " ✗"}`} | ${r.confidence} | ${String(r.detail).replace(/\|/g, "/")}${r.ask ? " · asks size" : ""} |`),
  "",
  "Reference sources are in parity/meals.json.",
].join("\n");
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `${stamp}.md`), md + "\n");
fs.writeFileSync(path.join(OUT, `${stamp}.json`), JSON.stringify({ summary, compare, results }, null, 2) + "\n");
console.log(`\nMatch rate ${summary.match_rate}% (±${TOL}%, ${trusted.length} trusted refs), median |err| ${summary.median_abs_err}%, mean signed ${summary.mean_signed_err}%; low-confidence refs ${summary.low_conf_match_rate}%`);
console.log(`Stated ${summary.stated.match_rate}% (${summary.stated.meals}), asks size ${summary.asks_size.match_rate}% (${summary.asks_size.meals})`);
if (compare) console.log(`Like for like vs ${compare.against}: ${compare.previous.match_rate}% → ${compare.now.match_rate}%, median |err| ${compare.previous.median_abs_err}% → ${compare.now.median_abs_err}%; refs changed: ${compare.ref_changes.length}`);
console.log(`Worst: ${worst.map((w) => `${w.id} ${w.err}%`).join(", ")}`);
console.log(`Report: ${path.relative(process.cwd(), path.join(OUT, `${stamp}.md`))}`);
