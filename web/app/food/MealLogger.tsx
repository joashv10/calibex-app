"use client";
// The meal logger. Type what you ate like a text ("2 idli + sambar") or tap a recent;
// every dish gets a portion (small / regular / large, or exact grams) and macros for
// YOUR plate, not per 100 g. One pinned button logs it. The meal and time come from
// the clock (tap the header to change them). Estimates lean low on purpose:
// overestimation compounds through the analysis.
import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import * as fd from "@/lib/food";
import { caffeineMg } from "@/lib/caffeine";
import { slotPicks } from "@/lib/recents";
import { blockingAsk, findRef, pickFor, refByName, refLabel, withOil, type Pick } from "@/lib/foodRef";
import { atTime, currentTouchpoint, isBackfill, logDate } from "@/lib/day";
import { keyboardUp, pinnedSheet, useVisibleViewport } from "@/lib/viewport";
import { TimeField } from "../TimeField";

// Typical clock time per meal: the default when backfilling, where "now" means nothing.
const SLOT_CLOCK: Record<string, string> = { breakfast: "08:30", lunch: "13:30", afternoon: "16:30", dinner: "20:30" };
const SIZES = ["small", "regular", "large"] as const;
// A pack or a listed serving is a fixed unit, not a size to guess: half, one, or two of it.
const UNITS: Record<(typeof SIZES)[number], string> = { small: "½", regular: "1", large: "2" };
const packed = (from?: fd.NumbersFrom) => from === "label" || from === "web";
const units = (one: number) => ({ small: Math.round(one / 2), regular: Math.round(one), large: Math.round(one * 2) });
const plural = (u: string) => (/(s|x|ch|sh)$/.test(u) ? `${u}es` : `${u}s`);
const OILS = ["low", "normal", "high"] as const;

type LDish = {
  key: number; food: string; brand: string | null;
  size: fd.Portion | "g" | "pick"; grams: Record<fd.Portion, number> | null; exact: string;
  per100: fd.Per100 | null; cooked: boolean; oil: string;
  source: "claude" | "recent" | "manual"; editMacros: boolean; busy: boolean;
  pill?: boolean; caffeine100?: number; // from the meal reader: a caffeine dose, or mg per 100 g
  from?: fd.NumbersFrom; basis?: string; // where the reader's numbers came from, and how a label was scaled
  pick?: Pick; ref?: string; // a food-table dish: the chips (pieces or bowls) and its table key
  ask?: boolean; // they didn't say how many / how much: the row asks, the modest default stays picked
  input?: string; // what was typed (or "photo") to get this dish, kept for audit
  out?: boolean; // eaten out: the table dish started on high oil / a bowl
  drink?: boolean; // a drink never blocks the Log button with a question
};
let keySeq = 0;

const gramsOf = (d: LDish) => (d.size === "g" ? parseFloat(d.exact) || 0
  : d.size === "pick" ? d.pick?.opts[d.pick.i].g ?? 0 : d.grams?.[d.size] ?? 0);
const isTable = (d: LDish) => d.from === "table" && d.source === "claude"; // numbers straight from the food table
// The line under a dish saying where its numbers came from; it follows the chips. Stored with the log.
const basisOf = (d: LDish): string | null => {
  if (isTable(d)) {
    const g = Math.round(gramsOf(d));
    // eaten out already means high oil; any other non-normal oil chip is said too
    const tail = `${d.out ? " · eaten out" : ""}${d.oil !== "normal" && !(d.out && d.oil === "high") ? ` · ${d.oil} oil` : ""}`;
    if (d.size === "pick" && d.pick) {
      const o = d.pick.opts[d.pick.i];
      const what = / g$/.test(o.label) ? "" : `${d.pick.unit ? `${o.label} ${d.pick.unit}` : `1 ${o.label}`} · `; // a stated "200 g" chip is just the grams
      return `${what}${g} g · ${refLabel(findRef(d.ref))}${tail}`;
    }
    return `${g} g · ${refLabel(findRef(d.ref))}${tail}`;
  }
  if (d.source !== "claude" || !d.basis) return null;
  // a non-table piece food (cookie): the assumption follows the chip, "2 cookies ≈ 40 g · AI estimate"
  if (d.size === "pick" && d.pick?.unit) {
    const n = d.pick.opts[d.pick.i].label;
    return `${n} ${Number(n) > 1 ? plural(d.pick.unit) : d.pick.unit} ≈ ${Math.round(gramsOf(d))} g · AI ${d.basis} · tap edit if it looks off`;
  }
  return d.basis.startsWith("estimate") ? `AI ${d.basis} · tap edit if it looks off` : d.basis;
};
const isPill = (d: LDish) => d.pill ?? fd.isCaffeinePill(d.food);
const macrosOf = (d: LDish) => (d.per100 && !isPill(d) ? fd.scale(d.per100, gramsOf(d)) : null);
// Caffeine a food or drink carries, in mg: the reader's mg per 100 g when it gave one,
// else a typical figure by name (lib/caffeine). Pills go to Supplements instead.
const caffeineIn = (d: LDish): number => (isPill(d) ? 0 : caffeineMg(d.food, gramsOf(d), d.caffeine100));
// A caffeine pill's number is mg, set only by its dose chips or typed exactly.
const mgOf = (d: LDish) => (d.size === "g" ? parseFloat(d.exact) || 0 : 0);
const PILL_MG = [100, 200, 300];
// Logging after the fact is the norm: one tap sets when you actually ate.
const ago = (min: number) => new Date(Date.now() - min * 60000).toTimeString().slice(0, 5);
const AGO = [{ l: "now", m: 0 }, { l: "30 min ago", m: 30 }, { l: "1 h ago", m: 60 }, { l: "2 h ago", m: 120 }];

export default function MealLogger({ presetSlot, recents, onClose, onAdded }: {
  presetSlot?: string | null; recents: fd.RecentFood[]; onClose: () => void; onAdded: () => void;
}) {
  const [slot, setSlot] = useState(() => presetSlot || currentTouchpoint(new Date()));
  const picks = useMemo(() => slotPicks(recents, slot), [recents, slot]);
  const [time, setTime] = useState(() => isBackfill()
    ? SLOT_CLOCK[presetSlot || currentTouchpoint(new Date())] ?? "13:00"
    : new Date().toTimeString().slice(0, 5));
  const [ctxOpen, setCtxOpen] = useState(false);
  const [agoMin, setAgoMin] = useState(0); // which "when" chip is on (ignored while "other time" is open)
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState("");
  const [dishes, setDishes] = useState<LDish[]>([]);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blockDone, setBlockDone] = useState(false);
  const box = useVisibleViewport();
  const pin = pinnedSheet(box); // sit on top of the keyboard, not behind it
  // Keyboard up: the sheet has ~half the screen, so drop what isn't needed to type.
  const kb = keyboardUp(box);

  const upd = (key: number, patch: Partial<LDish>) => setDishes((c) => c.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const photoIn = useRef<HTMLInputElement>(null);
  // A screenshot of listed macros or a label waits beside the text box; → reads both together.
  const [photo, setPhoto] = useState<fd.Photo | null>(null);
  const attach = async (file: File | undefined) => {
    if (!file || reading) return;
    try { setPhoto(await fd.photoFromFile(file)); setNote(""); }
    catch (e) { console.error(e); setNote("Couldn't open that image. Try a screenshot."); }
  };
  const inFlight = useRef(false); // a same-tick double submit can't send twice
  const read = async () => {
    const t = text.trim();
    if ((!t && !photo) || reading || inFlight.current) return;
    inFlight.current = true; setReading(true); setNote("");
    const r = await fd.parseMeal(t, photo ?? undefined);
    inFlight.current = false; setReading(false);
    setText(""); setPhoto(null);
    const input = photo ? (t ? `photo: ${t}` : "photo") : t;
    if (Array.isArray(r) && r.length) {
      setBlockDone(false); // one question per read: dishes added later may ask their own
      setDishes((c) => [...c, ...r.map((p): LDish => (p.dose_mg ? {
        // a caffeine dose arrives with its mg already set
        key: ++keySeq, food: p.food, brand: null, size: "g", grams: null, exact: String(Math.round(p.dose_mg)),
        per100: null, cooked: false, oil: "normal", source: "claude", editMacros: false, busy: false, pill: true,
      } : p.pick ? {
        // a table dish, or a model-estimated piece food (cookie) with a count to ask
        key: ++keySeq, food: p.food, brand: null, size: "pick", grams: null, exact: String(p.pick.opts[p.pick.i].g),
        per100: p.per100, cooked: p.cooked, oil: p.oil ?? "normal", source: "claude", editMacros: false, busy: false,
        pill: false, caffeine100: p.caffeine_100 || undefined, from: p.source === "table" ? "table" : p.source, basis: p.source === "table" ? undefined : p.basis || undefined,
        pick: p.pick, ref: p.ref, ask: p.ask, input, out: p.out, drink: p.drink,
      } : {
        key: ++keySeq, food: p.food, brand: null, size: p.portion, grams: packed(p.source) ? units(p.grams.regular) : p.grams, exact: String(p.grams[p.portion]),
        per100: p.per100, cooked: p.cooked, oil: "normal", source: "claude", editMacros: false, busy: false,
        pill: false, caffeine100: p.caffeine_100, from: p.source, basis: p.basis || undefined,
        ask: p.ask, input, drink: p.drink,
      }))]);
      return;
    }
    if (!t) { setNote(r === "unconfigured" ? "The estimator isn't connected." : "Couldn't read that image. Type what you ate instead."); return; }
    // Couldn't read it: keep what was typed as a manual dish, so nothing is lost.
    setDishes((c) => [...c, {
      key: ++keySeq, food: t, brand: null, size: "g", grams: null, exact: "", per100: null,
      cooked: false, oil: "normal", source: "manual", editMacros: true, busy: false,
    }]);
    setNote(r === "unconfigured" ? "The estimator isn't connected. Add grams (and macros if you know them)."
      : Array.isArray(r) ? "That didn't read as food. Fix it below, or remove it."
      : "Couldn't estimate that one. Add grams; macros are optional.");
  };

  const addRecent = (f: fd.RecentFood) => {
    // A table piece food comes back as its count ("2 roti"), with the table's numbers, not an old estimate.
    const ref = f.brand ? null : refByName(f.food);
    if (ref?.serve.kind === "piece") {
      const pick = pickFor(ref, f.grams / ref.serve.g, "");
      const oil = f.oiliness ?? "normal";
      return setDishes((c) => [...c, {
        key: ++keySeq, food: f.food, brand: null, size: "pick", grams: null, exact: String(pick.opts[pick.i].g),
        per100: withOil(ref, oil), cooked: ref.oil100 > 0, oil, source: "claude", editMacros: false, busy: false,
        pill: false, from: "table", pick, ref: ref.key, ask: pick.ask,
      }]);
    }
    setDishes((c) => [...c, {
      key: ++keySeq, food: f.food, brand: f.brand, size: "g", grams: null, exact: String(f.grams), per100: f.per100,
      cooked: f.oiliness != null, oil: f.oiliness ?? "normal", source: "recent", editMacros: false, busy: false,
    }]);
  };

  // Oil level changes a cooked dish's fat: re-estimate its per-100 g at that level.
  const setOil = async (d: LDish, oil: string) => {
    const ref = isTable(d) ? findRef(d.ref) : null;
    // the table already knows: no estimate call. Taking the oil off "high" undoes the eaten-out default.
    if (ref) { upd(d.key, { oil, per100: withOil(ref, oil), ...(oil !== "high" ? { out: false } : {}) }); return; }
    upd(d.key, { oil, busy: true });
    const r = await fd.estimatePer100(d.food, d.brand ?? "", oil);
    upd(d.key, { busy: false, ...(r && r !== "unconfigured" ? { per100: r } : {}) });
  };

  const totals = dishes.reduce((a, d) => {
    const m = macrosOf(d);
    return m ? { kcal: a.kcal + m.kcal, any: true } : a;
  }, { kcal: 0, any: false });
  // One blocking question per read at most (see blockingAsk); once it is answered nothing else blocks until the next read.
  const kcalAt = (d: LDish, g: number) => (d.per100 ? fd.scale(d.per100, g).kcal : 0);
  const askDishes = dishes.map((d) => {
    const now = kcalAt(d, gramsOf(d)), asking = !!d.ask && d.size !== "g" && !isPill(d) && !!d.per100;
    // next option up: the next chip (1→2, katori→bowl) or the next size (small→regular→large)
    const nextG = d.size === "pick" && d.pick ? d.pick.opts[d.pick.i + 1]?.g
      : d.grams && d.size !== "g" && d.size !== "pick" ? d.grams[SIZES[SIZES.indexOf(d.size) + 1]] : undefined;
    return { asking, isDrink: !!d.drink, kcalNow: now, kcalNext: nextG != null ? kcalAt(d, nextG) : now };
  });
  const blocker = blockDone ? undefined : dishes[blockingAsk(askDishes, totals.kcal)];
  const missing = dishes.find((d) => (isPill(d) ? mgOf(d) : gramsOf(d)) <= 0);
  const caffeinated = dishes.reduce((a, d) => a + caffeineIn(d), 0);

  const log = async () => {
    if (!dishes.length || missing || submitting) return;
    setSubmitting(true); setErr(null);
    try {
      const eatenAt = atTime(logDate(), time).toISOString(); // every dish shares the meal's clock time
      for (const d of dishes) {
        if (isPill(d)) { // a caffeine pill is a supplement, logged in mg
          await fd.logSupplement(fd.pillName(d.food), mgOf(d), "mg", eatenAt);
          continue;
        }
        const m = macrosOf(d);
        // a model estimate never overwrites a food-table row of the same name
        if (d.per100 && d.source !== "recent" && (isTable(d) || !refByName(d.food))) await fd.upsertFood({ name: d.food, brand: d.brand, ...d.per100, source: d.source === "claude" && d.from && d.from !== "estimate" ? d.from : d.source });
        await fd.logFood({ slot, food: d.food, brand: d.brand, grams: gramsOf(d), oiliness: d.cooked ? d.oil : null, eatenAt, ...(m ?? {}),
          input: d.input ?? null, basis: d.source === "claude" ? basisOf(d)?.replace(/ · tap edit if it looks off$/, "") ?? null : null });
        const mg = caffeineIn(d);
        if (mg) await fd.logCaffeine(d.food, mg, eatenAt);
      }
      if (saveName?.trim()) {
        await fd.saveMeal(saveName.trim(), slot, dishes.map((d) => ({
          food: d.food, brand: d.brand, grams: gramsOf(d), oiliness: d.cooked ? d.oil : null, per100: d.per100,
        })));
      }
      onAdded();
    } catch (e) {
      console.error(e);
      setErr("Couldn't save. Check your connection and try again.");
      setSubmitting(false);
    }
  };

  const clock = atTime(logDate(), time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const label = slot[0].toUpperCase() + slot.slice(1);

  return (
    <motion.div className="sheet-bg" initial={{ backgroundColor: "rgba(0,0,0,0)" }} animate={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      exit={{ backgroundColor: "rgba(0,0,0,0)" }} onClick={onClose} style={pin.overlay}>
      <motion.div className="sheet logsheet meal" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 320 }} onClick={(e) => e.stopPropagation()} style={pin.sheet}>
        <div className="lg-head">
          <button className="lg-ctx" onClick={() => setCtxOpen((o) => !o)} aria-expanded={ctxOpen}>
            {label} · {clock} <span aria-hidden>✎</span>
          </button>
          <button className="lg-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {/* Keyboard up: fold the "when" chips and time wheels away so the dish box stays in
            view above the keyboard. The chosen time stays in the header and comes back on close. */}
        {!isBackfill() && !kb && (
          <div className="chips small lg-when" role="group" aria-label="When you ate">
            {AGO.map((a) => (
              <button key={a.m} className={`chip ${!ctxOpen && agoMin === a.m ? "sel" : ""}`} onClick={() => { setTime(ago(a.m)); setAgoMin(a.m); setCtxOpen(false); }}>{a.l}</button>
            ))}
            <button className={`chip ${ctxOpen ? "sel" : ""}`} onClick={() => setCtxOpen(true)}>other time</button>
          </div>
        )}
        {ctxOpen && !kb && (
          <div className="lg-ctxbody">
            <div className="chips small">
              {fd.SLOTS.map((s) => <button key={s} className={`chip ${slot === s ? "sel" : ""}`} onClick={() => setSlot(s)}>{s}</button>)}
            </div>
            <div className="mealtime"><span>eaten at</span><TimeField value={time} onChange={(t) => { setTime(t); setAgoMin(-1); }} label="time eaten" /></div>
          </div>
        )}

        <div className="logscroll">
          <form className="lg-input" onSubmit={(e) => { e.preventDefault(); read(); }}>
            <input className="finput" placeholder={photo ? "Add a note (optional)" : "What did you eat?"} value={text}
              onChange={(e) => setText(e.target.value)} enterKeyHint="go" autoFocus={!dishes.length} />
            <button className="lg-photo" type="button" onClick={() => photoIn.current?.click()} disabled={reading} aria-label="Read a screenshot or label">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="13" r="3.5" />
              </svg>
            </button>
            <input ref={photoIn} type="file" accept="image/*" hidden onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ""; }} />
            <button className="lg-send" type="submit" disabled={(!text.trim() && !photo) || reading} aria-label="Read">{reading ? "…" : "→"}</button>
          </form>
          {photo && (
            <div className="lg-attached">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:${photo.media_type};base64,${photo.data}`} alt="Attached screenshot" />
              <span>{reading ? "Reading the screenshot…" : "Screenshot attached. Tap → to read it."}</span>
              {!reading && <button type="button" onClick={() => setPhoto(null)} aria-label="Remove screenshot">✕</button>}
            </div>
          )}
          {picks.length > 0 && (
            <div className="lg-recents" aria-label={`Foods you've had at ${slot}`}>
              {picks.map((r) => (
                <button key={r.food} className="rchip" onClick={() => addRecent(r)}>{r.food}<em>{r.grams} g</em></button>
              ))}
            </div>
          )}
          {note && <div className="fnote">{note}</div>}

          {dishes.map((d) => (
            <DishRow key={d.key} d={d} upd={(p) => { if (d === blocker && (p.ask === false || p.size === "g")) setBlockDone(true); upd(d.key, p); }} onOil={(o) => setOil(d, o)}
              onRemove={() => setDishes((c) => c.filter((x) => x.key !== d.key))} />
          ))}
          {reading && (
            <div className="ldish" aria-label="Reading your meal">
              <span className="sk" style={{ display: "block", width: "48%", height: 14 }} />
              <span className="sk" style={{ display: "block", width: "100%", height: 34, marginTop: 12 }} />
            </div>
          )}
          {!dishes.length && !reading && (
            <div className="lg-empty">Type it like a text: <b>penne alfredo, 1 plate + a coke</b>. CALIBEX splits it into dishes and estimates each one for your plate. You check the portions and log.</div>
          )}
        </div>

        {!(kb && !dishes.length) && <div className="sheet-foot">
          {caffeinated > 0 && <div className="fhint">Has caffeine: also logs about {caffeinated} mg in Drinks for your caffeine timing.</div>}
          {dishes.length > 0 && (saveName === null
            ? <button className="lg-save" onClick={() => setSaveName("")}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 4h12v16l-6-4-6 4z" /></svg>
                Save as a meal to re-log later
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
              </button>
            : <input className="finput" placeholder="Meal name, e.g. office lunch" value={saveName} autoFocus onChange={(e) => setSaveName(e.target.value)} />)}
          {err && <div className="sheet-err">{err}</div>}
          <button className="addbtn" onClick={log} disabled={!dishes.length || !!missing || !!blocker || submitting}>
            {submitting ? "Logging…"
              : !dishes.length ? "Type what you ate"
              : missing ? (isPill(missing) ? `Pick a dose for ${missing.food}` : `Add grams for ${missing.food}`)
              : blocker ? (blocker.pick?.unit ? `How many ${plural(blocker.pick.unit)}?` : `How much ${blocker.food.toLowerCase()}?`)
              : `Log ${slot}${totals.any ? ` · ${totals.kcal} kcal` : ""}`}
          </button>
        </div>}
      </motion.div>
    </motion.div>
  );
}

// Caffeine pill: pick the dose. It logs under Supplements at the meal's time, not as food.
function PillRow({ d, upd, onRemove }: { d: LDish; upd: (p: Partial<LDish>) => void; onRemove: () => void }) {
  const mg = mgOf(d);
  const custom = d.size === "g" && !PILL_MG.includes(mg);
  return (
    <div className="ldish">
      <div className="ldish-h">
        <b>{d.food}</b>
        <button className="fdel" onClick={onRemove} aria-label={`remove ${d.food}`}>✕</button>
      </div>
      <div className="portions">
        {PILL_MG.map((v) => (
          <button key={v} className={`pchip${d.size === "g" && mg === v ? " sel" : ""}`} onClick={() => upd({ size: "g", exact: String(v) })}>{v} mg</button>
        ))}
        <label className={`pgrams${custom && mg ? "" : custom ? " need" : ""}`}>
          <input type="number" inputMode="decimal" placeholder="mg" value={custom ? d.exact : ""}
            onChange={(e) => upd({ size: "g", exact: e.target.value })} aria-label={`mg of ${d.food}`} />
          <span>mg</span>
        </label>
      </div>
      <div className="ldish-mac">
        <span>{mg ? `logs under Supplements · ${mg} mg` : "pick the dose"}</span>
      </div>
    </div>
  );
}

function DishRow({ d, upd, onOil, onRemove }: {
  d: LDish; upd: (p: Partial<LDish>) => void; onOil: (o: string) => void; onRemove: () => void;
}) {
  if (isPill(d)) return <PillRow d={d} upd={upd} onRemove={onRemove} />;
  const g = gramsOf(d);
  const m = macrosOf(d);
  const approx = d.source === "claude" && !packed(d.from) && d.size !== "g" && d.size !== "pick" ? "~" : "";
  const line = basisOf(d);
  const pick = d.pick;
  const asking = !!d.ask && d.size !== "g";
  const pieces = !!pick?.unit;
  return (
    <div className={`ldish${asking ? " ask" : ""}`}>
      <div className="ldish-h">
        <b>{d.food}</b>
        <button className="fdel" onClick={onRemove} aria-label={`remove ${d.food}`}>✕</button>
      </div>
      {asking && <div className="ldish-ask">{pieces ? "How many?" : "How much?"}</div>}
      <div className="portions">
        {pick && pieces && <span className="punit">{pick.unit}</span>}
        {pick && pick.opts.map((o, i) => (
          <button key={o.label} className={`pchip${d.size === "pick" && pick.i === i ? " sel" : ""}`}
            onClick={() => upd({ size: "pick", pick: { ...pick, i }, ask: false })}
            aria-label={pieces ? `${o.label} ${pick.unit}` : `1 ${o.label}`}>{o.label}</button>
        ))}
        {d.grams && SIZES.map((p) => (
          <button key={p} className={`pchip${d.size === p ? " sel" : ""}`} onClick={() => upd({ size: p, ask: false })}
            aria-label={packed(d.from) ? `${UNITS[p]} × ${d.grams!.regular} g` : undefined}>{packed(d.from) ? UNITS[p] : p}</button>
        ))}
        {d.size === "g" || (!d.grams && !pick) ? (
          <label className={`pgrams${g ? "" : " need"}`}>
            <input type="number" inputMode="decimal" placeholder="grams" value={d.exact} autoFocus={!d.exact}
              onChange={(e) => upd({ size: "g", exact: e.target.value, ask: false })} aria-label={`grams of ${d.food}`} />
            <span>g</span>
          </label>
        ) : (
          <button className="pchip" onClick={() => upd({ size: "g", exact: String(g) })}>g</button>
        )}
      </div>
      <div className="ldish-mac">
        <span>{g ? `${approx}${Math.round(g)} g` : "add grams"}{m ? ` · ${m.kcal} kcal` : " · macros pending"}</span>
        <button className="lg-link" onClick={() => upd({ editMacros: !d.editMacros })}>{d.editMacros ? "done" : "edit"}</button>
      </div>
      {m && !d.editMacros && <div className="ldish-pcf">{m.protein_g} g protein · {m.carb_g} g carbs · {m.fat_g} g fat{m.fibre_g ? ` · ${m.fibre_g} g fibre` : ""}</div>}
      {line && !d.editMacros && <div className="ldish-src">{line}</div>}
      {d.editMacros && <Per100Editor per100={d.per100} onChange={(p) => upd({ per100: p, source: d.source === "claude" ? "manual" : d.source })} />}
      {d.cooked && (
        <div className="ldish-oil">
          <span>oil</span>
          {OILS.map((o) => <button key={o} className={`pchip${d.oil === o ? " sel" : ""}`} disabled={d.busy} onClick={() => onOil(o)}>{o}</button>)}
          {d.busy && <em>updating…</em>}
        </div>
      )}
    </div>
  );
}

// Manual correction, per 100 g (how labels print it).
function Per100Editor({ per100, onChange }: { per100: fd.Per100 | null; onChange: (p: fd.Per100) => void }) {
  const p = per100 ?? { kcal_100: 0, protein_100: 0, carb_100: 0, fat_100: 0 };
  const set = (k: keyof fd.Per100) => (e: ChangeEvent<HTMLInputElement>) => onChange({ ...p, [k]: parseFloat(e.target.value) || 0 });
  const v = (n: number) => (n ? String(n) : "");
  return (
    <div className="per100">
      <span className="per100-h">per 100g</span>
      <label>kcal<input type="number" inputMode="decimal" value={v(p.kcal_100)} onChange={set("kcal_100")} /></label>
      <label>protein<input type="number" inputMode="decimal" value={v(p.protein_100)} onChange={set("protein_100")} /></label>
      <label>carbs<input type="number" inputMode="decimal" value={v(p.carb_100)} onChange={set("carb_100")} /></label>
      <label>fat<input type="number" inputMode="decimal" value={v(p.fat_100)} onChange={set("fat_100")} /></label>
    </div>
  );
}
