"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import * as fd from "@/lib/food";
import { caffeineMg, caffeineTotal } from "@/lib/caffeine";
import { useTapLog } from "@/lib/useTapLog";
import { getSettings, saveSettings } from "@/lib/settings";
import { ensureAuth } from "@/lib/data";
import { atTime, canEdit, currentTouchpoint, dayTitle, dayWord, isBackfill, logDate, setLogDay, useLogDay, wakeDate } from "@/lib/day";
import { useOpenRequest } from "@/lib/deeplink";
import DayPicker, { ViewOnly } from "../DayPicker";
import MealLogger from "./MealLogger";
import { pinnedSheet, useVisibleViewport } from "@/lib/viewport";
import { TimeField } from "../TimeField";
import * as alc from "@/lib/alcohol";
import { dayFibreSugar, fibreSugarLine } from "@/lib/fibreSugar";
import UndoIcon from "../UndoIcon";
import SearchIcon from "../SearchIcon";
import { PRODUCT_UNITS, brandable, notMapped, nutrientSummary, rescaleNutrients, scaleNutrients, siteOf, sumNutrients, unitsTaken, type ProductUnit } from "@/lib/supplements";

const EASE = [0.16, 1, 0.3, 1] as const;
// Typical clock time per meal slot: the default when backfilling a past day, where "now" is meaningless.
const SLOT_CLOCK: Record<string, string> = { breakfast: "08:30", lunch: "13:30", afternoon: "16:30", dinner: "20:30" };

export default function FoodPage() {
  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState<fd.LogItem[]>([]);
  const [meals, setMeals] = useState<fd.Meal[]>([]);
  const [adding, setAdding] = useState(false);
  const [presetSlot, setPresetSlot] = useState<string | null>(null);
  const [substances, setSubstances] = useState<fd.Substance[]>([]);
  const [supplements, setSupplements] = useState<fd.Supplement[]>([]);
  const [products, setProducts] = useState<fd.SupplementProduct[]>([]);
  const [water, setWater] = useState<fd.Water[]>([]);
  const [bottleMl, setBottleMl] = useState(500);
  const [editBottle, setEditBottle] = useState(false);
  const [skips, setSkips] = useState<Set<string>>(new Set());
  const [recentFoods, setRecentFoods] = useState<fd.RecentFood[]>([]);
  const [suppHistory, setSuppHistory] = useState<{ names: string[]; last: Record<string, fd.Dose>; brand: Record<string, string> }>({ names: [], last: {}, brand: {} });
  const [subKind, setSubKind] = useState<"alcohol" | "caffeine" | null>(null);
  const [alcKey, setAlcKey] = useState(0); // remounts the alcohol sheet empty for "add another drink"
  const [addingSupp, setAddingSupp] = useState(false);
  // a logged row tapped for editing
  const [editFood, setEditFood] = useState<fd.LogItem | null>(null);
  const [editDrink, setEditDrink] = useState<fd.Substance | null>(null);
  const [editSupp, setEditSupp] = useState<fd.Supplement | null>(null);
  const [reduced, setReduced] = useState(false);
  const day = useLogDay(); // the day in view
  const editable = canEdit(day); // older days are view-only
  useEffect(() => { setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  // /food?add=lunch (a reminder, or a check-in's "log what you ate") → open the logger
  // pre-slotted to that meal. Works on a cold start and when the app is already open.
  const { value: addSlot, consume: consumeAdd } = useOpenRequest("/food", "add");
  useEffect(() => {
    if (!addSlot) return;
    // A reminder is always about today; a backfilled check-in's link (&keep=1) stays on its day.
    const keep = new URLSearchParams(window.location.search).has("keep");
    if (!keep && logDate() !== wakeDate()) setLogDay(null);
    setPresetSlot(addSlot); setAdding(true); consumeAdd();
  }, [addSlot, consumeAdd]);

  // /food?drink=1 (the dinner check-in's "Log your drinks") → open the alcohol sheet.
  const { value: drinkReq, consume: consumeDrink } = useOpenRequest("/food", "drink");
  useEffect(() => {
    if (!drinkReq) return;
    const keep = new URLSearchParams(window.location.search).has("keep");
    if (!keep && logDate() !== wakeDate()) setLogDay(null);
    setSubKind("alcohol"); consumeDrink();
  }, [drinkReq, consumeDrink]);

  const load = useCallback(async () => {
    await ensureAuth();
    const [l, m, sub, sup, sh, sk, rf, w, se, pr] = await Promise.all([
      fd.getTodayLog(), fd.getMeals(),
      fd.getTodaySubstances(), fd.getTodaySupplements(), fd.getSupplementHistory(), fd.getSkips(), fd.getRecentFoods(),
      fd.getTodayWater(), getSettings(), fd.getProducts(),
    ]);
    setWater(w); if (se?.bottle_ml) setBottleMl(se.bottle_ml); setLog(l); setMeals(m); setSubstances(sub); setSupplements(sup); setSuppHistory(sh); setProducts(pr); setSkips(sk); setRecentFoods(rf); setLoading(false);
  }, []);
  useEffect(() => { load().catch((e) => { console.error(e); setLoading(false); }); }, [load, day]);

  // Drinks count in the day (alcohol is 7 kcal/g), shown as their own line under the total.
  const drinks = useMemo(() => substances.reduce((a, s) => s.substance === "alcohol" && s.alcohol_g != null
    ? { kcal: a.kcal + alc.drinkKcal(s.alcohol_g, s.carb_g), c: a.c + Number(s.carb_g ?? 0) } : a, { kcal: 0, c: 0 }), [substances]);
  const totals = useMemo(() => log.reduce((a, i) => ({
    kcal: a.kcal + (i.kcal ?? 0), p: a.p + (i.protein_g ?? 0), c: a.c + (i.carb_g ?? 0), f: a.f + (i.fat_g ?? 0),
  }), { kcal: drinks.kcal, p: 0, c: Math.round(drinks.c), f: 0 }), [log, drinks]);

  // Supplement rows (protein powder) are left out: fibre and sugar for supplements come later.
  const fs = useMemo(() => dayFibreSugar(log.filter((i) => i.brand !== fd.SUPP_BRAND), drinks.c), [log, drinks]);

  // Optimistic: the row flips on tap; a failed write reloads the truth.
  const setSkip = (slot: string, on: boolean) => {
    setSkips((cur) => { const n = new Set(cur); if (on) n.add(slot); else n.delete(slot); return n; });
    (on ? fd.skipMeal(slot) : fd.unskipMeal(slot)).catch((e) => { console.error(e); load().catch(console.error); });
  };

  const addMeal = async (m: fd.Meal) => {
    const slot = m.slot ?? currentTouchpoint(new Date()); // a saved snack re-logs as a snack
    // One-tap re-log has no time picker: yesterday gets the slot's typical time (created_at still marks it as late).
    const eatenAt = isBackfill() ? atTime(logDate(), SLOT_CLOCK[slot] ?? "13:00").toISOString() : undefined;
    for (const it of m.items) {
      // A saved caffeine pill re-logs as a supplement: its "grams" field holds the mg.
      if (fd.isCaffeinePill(it.food)) { await fd.logSupplement(fd.pillName(it.food), it.grams, "mg", eatenAt); continue; }
      const mac = it.per100 ? fd.scale(it.per100, it.grams) : {};
      await fd.logFood({ slot, food: it.food, brand: it.brand, grams: it.grams, oiliness: it.oiliness, eatenAt, ...mac });
      const mg = caffeineMg(it.food, it.grams); // a saved coffee still counts as caffeine
      if (mg) await fd.logCaffeine(it.food, mg, eatenAt);
    }
    load();
  };

  if (loading) return <div className="center">loading…</div>;
  // Protein-powder rows count in the totals above but show under Supplements.
  const foods = log.filter((i) => i.brand !== fd.SUPP_BRAND);
  // The day's label totals (supplements only), and how many of them have no numbers.
  const suppTotal = nutrientSummary(sumNutrients(supplements.map((s) => s.nutrients)));
  const suppOpen = notMapped(supplements);
  const scoopOf = (s: fd.Supplement) => log.find((i) => i.brand === fd.SUPP_BRAND && i.food === s.supplement_name
    && new Date(i.eaten_at).getTime() === new Date(s.logged_at).getTime());

  return (
    <main className="app">
      <div className="body">
        <div className="topbar">
          <Link href="/" className="back">‹ Today</Link>
          <span className="brand"><span className="logomark" aria-hidden />FOOD</span>
          <DayPicker />
        </div>

        <motion.div className="macrobar" initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={reduced ? { duration: 0 } : { duration: 0.5, ease: EASE }}>
          <div className="kcal"><b>{totals.kcal}</b><span>kcal {dayWord(day)}</span></div>
          {drinks.kcal > 0 && <div className="kcal-drinks">incl. {drinks.kcal} kcal from drinks</div>}
          <div className="macros">
            <div className="m"><b>{totals.p}<i>g</i></b><span>protein</span></div>
            <div className="m"><b>{totals.c}<i>g</i></b><span>carbs</span></div>
            <div className="m"><b>{totals.f}<i>g</i></b><span>fat</span></div>
          </div>
          {fs.show && <div className="kcal-drinks fs-line">{fibreSugarLine(fs)}</div>}
        </motion.div>

        {editable ? <button className="foodadd" onClick={() => { setPresetSlot(null); setAdding(true); }}>+ Add food</button> : <ViewOnly />}

        <div className="sec-h"><span>{dayTitle(day)}</span><span>{foods.length} item{foods.length === 1 ? "" : "s"}</span></div>
        <div className="fgroups">
          {[...fd.SLOTS, "other"].map((slot) => {
            const items = foods.filter((i) => (i.slot ?? "other") === slot);
            const meal = (fd.MEAL_SLOTS as readonly string[]).includes(slot);
            if (items.length === 0 && !meal) return null;
            if (items.length === 0) {
              // Empty meal: log it, or mark it skipped so "didn't eat" isn't mistaken for "forgot to log".
              const skipped = skips.has(slot);
              const snack = slot === "afternoon";
              return (
                <div className={`fslot${skipped ? " skipped" : ""}`} key={slot}>
                  <span className="fslot-nm">{slot}</span>
                  {skipped ? (<>
                    <span className="fslot-st">{snack ? "no snack" : "skipped"}</span>
                    {editable && <button className="tap-undo pill" onClick={() => setSkip(slot, false)}><UndoIcon />Undo</button>}
                  </>) : editable ? (<>
                    <button className="fslot-add" onClick={() => { setPresetSlot(slot); setAdding(true); }}>+ log</button>
                    <button className="fslot-link" onClick={() => setSkip(slot, true)}>{snack ? "no snack" : "didn't eat"}</button>
                  </>) : <span className="fslot-st">not logged</span>}
                </div>
              );
            }
            const sub = items.reduce((a, i) => ({ kcal: a.kcal + (i.kcal ?? 0), p: a.p + (i.protein_g ?? 0) }), { kcal: 0, p: 0 });
            return (
              <div className="fgroup" key={slot}>
                <div className="fgroup-h"><span>{slot}</span><span>{sub.kcal} kcal · {sub.p} g protein</span></div>
                <div className="flog">
                  {items.map((i) => (
                    <div className="fitem" key={i.id}>
                      <Main onEdit={editable ? () => setEditFood(i) : undefined}><b>{i.food}</b><span>{i.brand ? `${i.brand} · ` : ""}{i.grams}g · {fmtTime(i.eaten_at)}</span>
                        {i.kcal != null && <span className="fpcf">{i.protein_g} g protein · {i.carb_g} g carbs · {i.fat_g} g fat{i.fibre_g ? ` · ${i.fibre_g} g fibre` : ""}</span>}
                        {i.basis && <span className="fpcf fbasis">{i.basis}</span>}</Main>
                      <div className="fmac">{i.kcal != null ? `${i.kcal} kcal` : "macros pending"}</div>
                      {editable && <button className="fdel" onClick={async () => { await fd.deleteLogItem(i.id); load(); }} aria-label="remove">✕</button>}
                    </div>
                  ))}
                </div>
                {editable && slot !== "other" && <button className="fgroup-add" onClick={() => { setPresetSlot(slot); setAdding(true); }}>+ add to {slot === "afternoon" ? "snack" : slot}</button>}
              </div>
            );
          })}
        </div>

        {editable && meals.length > 0 && (
          <>
            <div className="sec-h"><span>Saved meals</span><span>tap to log</span></div>
            <div className="flog">
              {meals.map((m) => (
                <div className="fitem" key={m.id}>
                  <button className="mealtap" onClick={() => addMeal(m)} aria-label={`Log ${m.name}`}>
                    <b>{m.name}</b>
                    <span>{[m.slot, `${m.items.length} dish${m.items.length === 1 ? "" : "es"}`, mealKcal(m) ? `${mealKcal(m)} kcal` : null].filter(Boolean).join(" · ")}</span>
                  </button>
                  <span className="fmac" aria-hidden>+ log</span>
                  <button className="fdel" onClick={async () => { await fd.deleteMeal(m.id); load(); }} aria-label={`remove saved meal ${m.name}`}>✕</button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="sec-h"><span>Drinks</span><span>water · caffeine · alcohol</span></div>
        <WaterRow key={day} water={water} editable={editable} bottleMl={bottleMl} onChange={load} onBottle={() => setEditBottle(true)} />
        {editable && <div className="qrow" style={{ marginTop: 0 }}>
          <button className="qbtn" onClick={() => setSubKind("caffeine")}>Log caffeine</button>
          <button className="qbtn" onClick={() => setSubKind("alcohol")}>Log alcohol</button>
        </div>}
        {!editable && substances.length === 0 && <div className="empty">No drinks logged.</div>}
        {substances.length > 0 && (
          <div className="flog" style={{ marginTop: 8 }}>
            {substances.map((s) => (
              <div className="fitem" key={s.id}>
                <Main onEdit={editable ? () => setEditDrink(s) : undefined}><b>{drinkTitle(s)}</b><span className="plain">{drinkLabel(s)} · {fmtTime(s.consumed_at)}{s.ended_at ? `–${fmtTime(s.ended_at)}` : ""}</span></Main>
                {s.substance === "alcohol" && s.alcohol_g != null && <div className="fmac">{alc.drinkKcal(s.alcohol_g, s.carb_g)} kcal</div>}
                {editable && <button className="fdel" onClick={async () => { await fd.deleteSubstance(s.id); load(); }} aria-label="remove">✕</button>}
              </div>
            ))}
          </div>
        )}
        {caffeineTotal(substances, supplements) && <div className="fhint">{caffeineTotal(substances, supplements)}</div>}

        <div className="sec-h"><span>Supplements</span>{editable && <button className="seclink" onClick={() => setAddingSupp(true)}>+ add</button>}</div>
        {supplements.length === 0 ? (
          <div className="empty">{editable ? "Log what you take and when — creatine, vit D, omega-3… the timing feeds your recovery correlations." : "No supplements logged."}</div>
        ) : (
          <div className="flog">
            {supplements.map((s) => (
              <div className="fitem" key={s.id}>
                <Main onEdit={editable ? () => setEditSupp(s) : undefined}><b>{s.supplement_name}</b><span className="plain">{s.brand ? `${s.brand} · ` : ""}{s.dose_amount != null ? `${s.dose_amount} ${s.dose_unit ?? ""} · ` : ""}{fmtTime(s.logged_at)}</span>
                  {scoopOf(s) && <span className="fpcf">{scoopOf(s)!.protein_g} g protein · {scoopOf(s)!.carb_g} g carbs · {scoopOf(s)!.fat_g} g fat</span>}</Main>
                {scoopOf(s) && <div className="fmac">{scoopOf(s)!.kcal} kcal</div>}
                {editable && <button className="fdel" onClick={async () => { await fd.deleteSupplement(s); load(); }} aria-label="remove">✕</button>}
              </div>
            ))}
            {suppTotal && <div className="fhint">From supplements: {suppTotal}{suppOpen > 0 ? ` · ${suppOpen} not mapped` : ""}</div>}
          </div>
        )}
      </div>

      <AnimatePresence>
        {adding && <MealLogger presetSlot={presetSlot} recents={recentFoods} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); load(); }} />}
        {subKind === "alcohol" && <AlcoholLog key={alcKey} prior={substances} onClose={() => setSubKind(null)}
          onLogged={async (more) => {
            // the next drink's sheet reads the saved list when it opens: refresh first, so it carries this drink's window
            if (!more) { setSubKind(null); load(); return; }
            await load(); setAlcKey((k) => k + 1);
          }} />}
        {subKind === "caffeine" && <SubstanceLog kind={subKind} onClose={() => setSubKind(null)} onLogged={() => { setSubKind(null); load(); }}
          onNamed={() => { setSubKind(null); setPresetSlot(null); setAdding(true); }} />}
        {addingSupp && <SupplementLog history={suppHistory} products={products} onClose={() => setAddingSupp(false)} onLogged={() => { setAddingSupp(false); load(); }} />}
        {editFood && <FoodEdit item={editFood} onClose={() => setEditFood(null)} onSaved={() => { setEditFood(null); load(); }} />}
        {editDrink?.substance === "alcohol" && <AlcoholLog prior={substances} editing={editDrink} onClose={() => setEditDrink(null)}
          onLogged={async (more) => {
            if (!more) { setEditDrink(null); load(); return; }
            await load(); setEditDrink(null); setSubKind("alcohol"); setAlcKey((k) => k + 1);
          }} />}
        {editDrink?.substance === "caffeine" && <SubstanceLog kind={editDrink.substance} editing={editDrink} onClose={() => setEditDrink(null)} onLogged={() => { setEditDrink(null); load(); }} />}
        {editBottle && <BottleSize ml={bottleMl} onClose={() => setEditBottle(false)} onSaved={(ml) => { setBottleMl(ml); setEditBottle(false); }} />}
        {editSupp && <SupplementLog history={suppHistory} products={products} editing={editSupp} scoop={scoopOf(editSupp)} onClose={() => setEditSupp(null)} onLogged={() => { setEditSupp(null); load(); }} />}
      </AnimatePresence>
    </main>
  );
}

// A logged row's text. Tapping it opens its edit sheet (only on days that can still be edited).
function Main({ onEdit, children }: { onEdit?: () => void; children: ReactNode }) {
  return onEdit
    ? <button className="fmain ftap" onClick={onEdit}>{children}</button>
    : <div className="fmain">{children}</div>;
}
const clockOf = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

// Edit a logged dish: grams (its macros rescale) and when it was eaten.
function FoodEdit({ item, onClose, onSaved }: { item: fd.LogItem; onClose: () => void; onSaved: () => void }) {
  const [grams, setGrams] = useState(String(item.grams));
  const [time, setTime] = useState(() => clockOf(item.eaten_at));
  const [busy, setBusy] = useState(false);
  const pin = pinnedSheet(useVisibleViewport());
  const g = parseFloat(grams) || 0;
  const k = item.grams > 0 ? g / item.grams : 1;
  const save = async () => {
    if (g <= 0 || busy) return;
    setBusy(true);
    try { await fd.updateLogItem(item, Math.round(g), atTime(logDate(), time).toISOString()); onSaved(); }
    catch (e) { console.error(e); setBusy(false); }
  };
  return (
    <motion.div className="sheet-bg" initial={{ backgroundColor: "rgba(0,0,0,0)", backdropFilter: "blur(0px)" }}
      animate={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)" }}
      exit={{ backgroundColor: "rgba(0,0,0,0)", backdropFilter: "blur(0px)" }} onClick={onClose} style={pin.overlay}>
      <motion.div className="sheet addfood" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 320 }} onClick={(e) => e.stopPropagation()} style={pin.sheet}>
        <div className="sheet-h">{item.food}</div>
        <div className="frow">
          <input className="finput grams" type="number" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} aria-label="grams" />
          <span className="fhint" style={{ margin: 0 }}>g{item.kcal != null && g > 0 ? ` · ${Math.round(item.kcal * k)} kcal · ${Math.round((item.protein_g ?? 0) * k)} g protein` : ""}</span>
        </div>
        <div className="mealtime"><span>eaten at</span><TimeField value={time} onChange={setTime} label="time eaten" /></div>
        <button className="addbtn" onClick={save} disabled={g <= 0 || busy}>{busy ? "Saving…" : "Save"}</button>
        <button className="sheet-cancel" onClick={onClose}>cancel</button>
      </motion.div>
    </motion.div>
  );
}

// Water: one tap = one glass/bottle, added to the day's total on the right.
// Tap/undo bookkeeping lives in useTapLog.
const WATER_ICON: Record<string, ReactNode> = {
  glass: <path d="M6 4h12l-1.6 16H7.6zM6.6 9h10.8" />,
  bottle: <path d="M10 2h4v3l2 3v12a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V8l2-3zM8 12h8" />,
};
function WaterRow({ water, editable, bottleMl, onChange, onBottle }: {
  water: fd.Water[]; editable: boolean; bottleMl: number; onChange: () => void | Promise<void>; onBottle: () => void;
}) {
  const { shown, last, canUndo, add, undo } = useTapLog(water, onChange);
  const ml = shown.reduce((t, w) => t + Number(w.volume_ml), 0);
  const lastAt = [...shown].reverse().find((w) => w.logged_at)?.logged_at;
  if (!editable && !water.length) return null;
  return (
    <div className="tapcard">
      <div className="tap-top">
        <div className="tap-l"><b>Water</b><span>{lastAt ? `last at ${fmtTime(lastAt)}` : ml ? "logged, no time" : "nothing yet"}</span></div>
        <div className="tap-total">{ml >= 1000 ? +(ml / 1000).toFixed(2) : ml}<i>{ml >= 1000 ? "L" : "ml"}</i></div>
      </div>
      {editable && <>
        <div className="tap-btns">
          {fd.waterSizes(bottleMl).map((z) => (
            <button key={z.ml} className="tap-add" onClick={() => add(fd.newWater(z.ml), fd.logWater)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{WATER_ICON[z.label]}</svg>
              <span>Add a {z.label}<i>{z.ml} ml</i></span>
            </button>
          ))}
        </div>
        {/* always laid out, so the card doesn't grow on the first tap */}
        <div className="tap-foot">
          <button className={`tap-undo pill${last ? "" : " off"}`} onClick={() => last && undo(last.id, fd.deleteWater)} disabled={!canUndo} aria-hidden={!last}>
            <UndoIcon />{last ? `Undo last ${Number(last.volume_ml)} ml` : "Undo"}</button>
          <button className="tap-undo" onClick={onBottle}>Bottle size</button>
        </div>
      </>}
    </div>
  );
}

function drinkLabel(s: fd.Substance): string {
  if (s.substance === "caffeine") return s.caffeine_mg != null ? `${Math.round(s.caffeine_mg)} mg caffeine` : s.amount ? `${s.amount} cup${s.amount === 1 ? "" : "s"}` : `${s.dose_bucket} cups`;
  if (alc.isDrinkType(s.drink_type) && s.amount != null && s.volume_ml != null && s.alcohol_g != null)
    return `${alc.amountLabel(s.drink_type, s.amount, s.volume_ml / s.amount)} · ${alc.drinksLabel(s.alcohol_g)}`;
  return `${s.dose_bucket} drinks`;
}
function drinkTitle(s: fd.Substance): string {
  if (s.substance === "caffeine") return s.drink_name ?? "Caffeine";
  const type = alc.isDrinkType(s.drink_type) ? alc.DRINKS[s.drink_type].label : "Alcohol";
  return s.brand ? `${type} · ${s.brand}` : type;
}


function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function mealKcal(m: fd.Meal): number {
  return Math.round(m.items.reduce((t, it) => t + (it.per100 ? fd.scale(it.per100, it.grams).kcal : 0), 0));
}

// Alcohol/caffeine quick-log — dose buckets, logged at the moment you tap (real timing).
// Backfilling a past day there is no "moment", so a time field appears instead.
function SubstanceLog({ kind, editing, onClose, onLogged, onNamed }: {
  kind: "alcohol" | "caffeine"; editing?: fd.Substance; onClose: () => void; onLogged: () => void;
  onNamed?: () => void; // a specific coffee goes through the meal logger: photo, name, milk and sugar
}) {
  const opts = kind === "alcohol"
    ? [{ label: "1–2", dose: "1-2" }, { label: "3–4", dose: "3-4" }, { label: "5+", dose: "5+" }]
    : [{ label: "1 cup", dose: "1" }, { label: "2 cups", dose: "2" }, { label: "3 cups", dose: "3" }, { label: "4+", dose: "4+" }];
  const back = isBackfill() || !!editing; // editing always shows its time
  const [time, setTime] = useState(() => (editing ? clockOf(editing.consumed_at) : kind === "alcohol" ? "20:00" : "09:00"));
  const log = async (dose: string, i: number) => {
    const amount = kind === "caffeine" ? i + 1 : null;
    // Same button as before (e.g. only the time changed): keep the stored count and mg, so a
    // 5-cup row re-saved under "4+" isn't cut to 4. A new count scales a named drink's mg.
    const same = editing?.dose_bucket === dose;
    const mg = !same && kind === "caffeine" && editing?.caffeine_mg != null && editing.amount && amount ? Math.round((editing.caffeine_mg * amount) / editing.amount) : undefined;
    if (editing) await fd.updateSubstance(editing.id, dose, same ? editing.amount : amount, atTime(logDate(), time).toISOString(), mg);
    else await fd.logSubstance(kind, dose, amount, back ? atTime(logDate(), time).toISOString() : undefined);
    onLogged();
  };
  return (
    <motion.div className="sheet-bg" initial={{ backgroundColor: "rgba(0,0,0,0)", backdropFilter: "blur(0px)" }}
      animate={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }}
      exit={{ backgroundColor: "rgba(0,0,0,0)", backdropFilter: "blur(0px)" }} onClick={onClose}>
      <motion.div className="sheet" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 320 }} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">{editing ? `Change ${kind}` : kind === "alcohol" ? `Alcohol ${dayWord()}?` : isBackfill() ? `Caffeine ${dayWord()}?` : "Caffeine now?"}</div>
        {back && <div className="mealtime"><span>at</span><TimeField value={time} onChange={setTime} label="time" /></div>}
        <div className="sheet-opts">
          {opts.map((o, i) => <button key={o.dose} className={`sheet-opt${editing?.dose_bucket === o.dose ? " sel" : ""}`} onClick={() => log(o.dose, i)}>{o.label}</button>)}
        </div>
        {kind === "caffeine" && !editing && (<>
          <div className="fhint">Log each coffee when you have it: 11 AM and 3 PM are two entries. Caffeine pills go in Supplements.</div>
          {onNamed && <button className="lg-save" onClick={onNamed}>A specific coffee? Log it with a photo<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg></button>}
        </>)}
        <button className="sheet-cancel" onClick={onClose}>cancel</button>
      </motion.div>
    </motion.div>
  );
}

// Alcohol: what, how much, from when to when. One entry per drink type; a second drink
// the same night starts from the first one's window. Backfilling, the end time is only
// stored if you add it (a guessed one would be fake timing data).
function AlcoholLog({ prior, editing, onClose, onLogged }: {
  prior: fd.Substance[]; editing?: fd.Substance; onClose: () => void; onLogged: (another?: boolean) => void;
}) {
  const last = [...prior].reverse().find((p) => p.substance === "alcohol" && p.id !== editing?.id);
  const src = editing ?? last;
  const [type, setType] = useState<alc.DrinkType | null>(() => (alc.isDrinkType(editing?.drink_type) ? editing.drink_type : null));
  const [count, setCount] = useState(() => (editing?.amount != null && editing.drink_type ? String(editing.amount) : ""));
  const [size, setSize] = useState<number | null>(() =>
    editing?.volume_ml != null && editing.amount ? Math.round(editing.volume_ml / editing.amount) : null);
  const [abv, setAbv] = useState(() => (editing?.abv != null ? String(editing.abv) : ""));
  const [brand, setBrand] = useState(editing?.brand ?? "");
  // sugar per 100 ml, and where the % came from: the type's default, a brand lookup, or typed
  const [carb100, setCarb100] = useState<number | null>(() =>
    editing?.carb_g != null && editing.volume_ml ? (editing.carb_g / editing.volume_ml) * 100 : null);
  const [abvSrc, setAbvSrc] = useState<alc.AbvSource | null>(() => (alc.isAbvSource(editing?.abv_source) ? editing.abv_source : null));
  const [look, setLook] = useState<{ state: "busy" | "found" | "unknown" | "error"; name?: string | null; history?: boolean; site?: string | null; carb?: boolean } | null>(null);
  const lookSeq = useRef(0);
  const lookTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // the brand|type whose lookup has settled; until it matches, Save waits (no default % slips in)
  const [looked, setLooked] = useState(editing?.abv_source === "lookup" ? `${editing.brand?.trim()}|${editing.drink_type}` : "");
  const live = !isBackfill() && !editing;
  const nowClock = () => clockOf(new Date().toISOString());
  const [from, setFrom] = useState(() => {
    if (src) return clockOf(src.consumed_at);
    if (!live) return "20:00";
    // a live log is usually made at the end; never before 4 AM, which would read as tomorrow
    const d = new Date(Date.now() - 2 * 3600_000);
    d.setMinutes(Math.floor(d.getMinutes() / 15) * 15);
    if (new Date().getHours() >= 4 && d.getHours() < 4) d.setHours(4, 0);
    return clockOf(d.toISOString());
  });
  const [to, setTo] = useState<string | null>(() =>
    editing ? (editing.ended_at ? clockOf(editing.ended_at) : null) : last?.ended_at ? clockOf(last.ended_at) : live ? nowClock() : null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pin = pinnedSheet(useVisibleViewport());

  // a starting point for the wheels: two hours on, never past now
  const endGuess = (start: string) => clockOf(new Date(Math.min(atTime(logDate(), start).getTime() + 2 * 3600_000, Date.now())).toISOString());
  const spec = type ? alc.DRINKS[type] : null;
  const pick = (t: alc.DrinkType) => {
    setType(t); setErr(null);
    const sp = alc.DRINKS[t];
    setSize(sp.ml); setAbv(String(sp.abv)); setCarb100(sp.carb100); setAbvSrc("default");
    setLooked(""); setLook(null);
  };
  const typeBrand = (v: string) => {
    setBrand(v); setLook(null); lookSeq.current++;
    // a looked-up % belonged to the old name: back to the type's default until the new one is found
    if (abvSrc === "lookup" && spec) {
      setAbv(String(spec.abv)); setCarb100(spec.carb100); setAbvSrc("default"); setLooked("");
      if (spec.unit === "drink") setSize(spec.ml);
    }
  };
  // A brand fills its own % alc and sugar (Fireball is 33%, not whisky's 42.8). A % you typed is never overwritten.
  const readBrand = useCallback(async (b: string, t: alc.DrinkType, seq: number) => {
    setLook({ state: "busy" });
    const f = await fd.lookupDrink(b, t);
    if (seq !== lookSeq.current) return; // the brand or type changed while this was out
    setLooked(`${b}|${t}`);
    if (f === "error") { setLook({ state: "error" }); return; }
    if (!f) { setLook({ state: "unknown" }); return; }
    setAbv(String(f.abv)); setCarb100(f.carb100 ?? alc.DRINKS[t].carb100); setAbvSrc("lookup");
    if (f.serveMl && alc.DRINKS[t].unit === "drink") setSize(f.serveMl); // Long Island is ~250 ml, not the 200 ml default
    setLook({ state: "found", name: f.name, history: f.from === "history", site: f.site, carb: f.carb100 != null });
  }, []);
  useEffect(() => {
    const b = brand.trim();
    if (!type || b.length < 3 || abvSrc === "user" || looked === `${b}|${type}`) return;
    const seq = ++lookSeq.current;
    lookTimer.current = setTimeout(() => readBrand(b, type, seq), 1500); // a long pause; leaving the box or Enter looks up sooner
    return () => clearTimeout(lookTimer.current);
  }, [brand, type, abvSrc, looked, readBrand]);
  // → reads the brand now, even over a % you typed: tapping it asks for the label's number
  const readNow = () => {
    const b = brand.trim();
    if (!type || b.length < 2 || look?.state === "busy") return;
    clearTimeout(lookTimer.current); // the arrow beat the auto lookup: one call, not two
    readBrand(b, type, ++lookSeq.current);
  };
  // leaving the box, or Enter: look up now, unless this exact text was already looked up
  const readIfNew = () => {
    const b = brand.trim();
    if (!type || b.length < 3 || abvSrc === "user" || looked === `${b}|${type}` || look?.state === "busy") return;
    readNow();
  };
  const n = parseFloat(count);
  const unitMl = size ?? spec?.ml ?? 0;
  const pct = parseFloat(abv);
  const ok = !!spec && n > 0 && n <= 40 && pct > 0 && pct <= 100;
  const grams = ok ? alc.alcoholG(n * unitMl, pct) : 0;
  const carbs = ok ? alc.carbG(n * unitMl, carb100 ?? spec.carb100) : 0;
  const busyLook = look?.state === "busy" || (!!type && brand.trim().length >= 3 && abvSrc !== "user" && looked !== `${brand.trim()}|${type}`);

  const submit = async (another = false) => {
    if (!ok || !type || busy || busyLook) return;
    const start = atTime(logDate(), from);
    let end = to ? atTime(logDate(), to) : null;
    // A clock time earlier than the start is the next morning (8 PM → 5 AM), not the same day.
    if (end && end < start) end = new Date(end.getTime() + 24 * 3600_000);
    const bad = alc.windowError(start, end);
    if (bad) { setErr(bad); return; }
    const e: fd.AlcoholEntry = {
      drink_type: type, brand: brand.trim() || null, amount: n, volume_ml: Math.round(n * unitMl), abv: pct,
      alcohol_g: grams, dose_bucket: alc.bucketOf(grams), consumed_at: start.toISOString(), ended_at: end ? end.toISOString() : null,
      carb_g: carbs, abv_source: abvSrc,
    };
    setBusy(true);
    try {
      if (editing) await fd.updateAlcohol(editing.id, e); else await fd.logAlcohol(e);
      onLogged(another); // "another" reopens a fresh sheet for the next drink
    } catch (x) { console.error(x); setErr("Couldn't save. Try again."); setBusy(false); }
  };

  return (
    <motion.div className="sheet-bg" initial={{ backgroundColor: "rgba(0,0,0,0)", backdropFilter: "blur(0px)" }}
      animate={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)" }}
      exit={{ backgroundColor: "rgba(0,0,0,0)", backdropFilter: "blur(0px)" }} onClick={onClose} style={pin.overlay}>
      <motion.div className="sheet addfood" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 320 }} onClick={(e) => e.stopPropagation()} style={pin.sheet}>
        <div className="sheet-h">{editing ? "Edit alcohol" : `Alcohol ${dayWord()}`}</div>
        {editing && !editing.drink_type && <div className="fhint alc-old">Logged as {editing.dose_bucket} drinks. Pick what it was.</div>}
        <div className="uchips alc-types">
          {alc.DRINK_TYPES.map((t) => <button key={t} className={`uchip ${type === t ? "sel" : ""}`} onClick={() => pick(t)}>{alc.DRINKS[t].label}</button>)}
        </div>
        {spec && (<>
          <div className="frow alc-amt">
            <input className="finput grams" type="number" inputMode="decimal" placeholder="how many" value={count}
              onChange={(e) => { setCount(e.target.value); setErr(null); }} aria-label={`how many ${spec.units}`} />
            <span className="alc-unit">{n === 1 ? spec.unit : spec.units}</span>
            {spec.sizes && <div className="uchips">{spec.sizes.map((ml) => (
              <button key={ml} className={`uchip ${unitMl === ml ? "sel" : ""}`} onClick={() => setSize(ml)}>{ml} ml</button>
            ))}</div>}
          </div>
          <div className="frow alc-abv">
            <input className="finput" placeholder="Brand, optional" value={brand} onChange={(e) => typeBrand(e.target.value)} aria-label="brand"
              enterKeyHint="go" onBlur={readIfNew} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); readIfNew(); } }} />
            <button className="lg-send alc-read" type="button" onClick={readNow} disabled={!brand.trim() || brand.trim().length < 2 || look?.state === "busy"}
              aria-label="Look up this brand">{look?.state === "busy" ? "…" : "→"}</button>
            <label><input className="finput grams" type="number" inputMode="decimal" value={abv}
              onChange={(e) => { setAbv(e.target.value); setAbvSrc("user"); setLook(null); lookSeq.current++; }} aria-label="alcohol percent" /><i>% alc</i></label>
          </div>
          {look && <div className="fhint alc-look" aria-live="polite">{
            look.state === "busy" ? `Looking up ${brand.trim()}…`
            : look.state === "found" ? (look.history ? `${pct}% alc, as last time you had ${brand.trim()}.`
              : `${look.name ?? brand.trim()}: ${pct}% alc${spec?.unit === "drink" ? `, ${unitMl} ml a drink` : ""}${look.carb && carb100 ? `, ${Math.round(carb100)} g sugar per 100 ml` : ""}${look.site ? ` · ${look.site}` : ""}. Looked up; check the label.`)
            : look.state === "unknown" ? `Not sure what ${brand.trim()} is. Check the label for % alc.`
            : "Couldn't look that up. Check the label for % alc."}</div>}
          <div className="fhint alc-sum">{ok ? `${alc.drinksLabel(grams)} · ${Math.round(grams)} g alcohol · ${alc.drinkKcal(grams, carbs)} kcal` : `${spec.unit === "peg" ? "A peg is 30 ml; a large is 2." : spec.unit === "glass" ? "A glass is 150 ml." : spec.unit === "drink" ? "A cocktail is about 1½ pegs." : "Pick the bottle size."}`}</div>
        </>)}
        <div className="mealtime alc-when">
          <span>from</span><TimeField value={from} onChange={(v) => { setFrom(v); setErr(null); }} label="started drinking" />
          {to != null
            ? <><span>to</span><TimeField value={to} onChange={(v) => { setTo(v); setErr(null); }} label="stopped drinking" /></>
            : <button className="seclink" onClick={() => setTo(endGuess(from))}>+ when you stopped</button>}
        </div>
        {err && <div className="sheet-err">{err}</div>}
        <button className="addbtn" onClick={() => submit()} disabled={!ok || busy || busyLook}>
          {/* a dimmed button says what it's waiting for */}
          {busyLook ? "Checking the % alc on the web…" : !spec ? "Pick the drink to save" : !(n > 0) ? `Add how many ${spec.units}` : !(pct > 0) ? "Add the % alc" : editing ? "Save" : "Log alcohol"}</button>
        {/* switched drinks (whisky, then beer): each drink is its own entry */}
        <button className="seclink alc-more" onClick={() => submit(true)} disabled={!ok || busy || busyLook}>Save and add another drink</button>
        <button className="sheet-cancel" onClick={onClose}>cancel</button>
      </motion.div>
    </motion.div>
  );
}

// Your bottle's size. Past taps keep the ml they were logged with.
function BottleSize({ ml, onClose, onSaved }: { ml: number; onClose: () => void; onSaved: (ml: number) => void }) {
  const presets = [500, 750, 1000];
  const [custom, setCustom] = useState(presets.includes(ml) ? "" : String(ml));
  const [err, setErr] = useState<string | null>(null);
  const pick = async (v: number) => {
    if (!(v >= 100 && v <= 3000)) { setErr("Between 100 and 3000 ml"); return; }
    try { await saveSettings({ bottle_ml: v }); onSaved(v); }
    catch (e) { console.error(e); setErr("Couldn't save. Try again."); }
  };
  const c = Math.round(Number(custom));
  return (
    <motion.div className="sheet-bg" initial={{ backgroundColor: "rgba(0,0,0,0)", backdropFilter: "blur(0px)" }}
      animate={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }}
      exit={{ backgroundColor: "rgba(0,0,0,0)", backdropFilter: "blur(0px)" }} onClick={onClose}>
      <motion.div className="sheet" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 320 }} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">Your bottle</div>
        <div className="sheet-opts">
          {presets.map((v) => (
            <button key={v} className={`sheet-opt${v === ml ? " sel" : ""}`} onClick={() => pick(v)}>{v >= 1000 ? `${v / 1000} L` : `${v} ml`}</button>
          ))}
        </div>
        <div className="frow bottle-other">
          <input className="finput grams" type="number" inputMode="numeric" placeholder="Other" value={custom}
            onChange={(e) => { setCustom(e.target.value); setErr(null); }} aria-label="bottle size in ml" />
          <span className="fhint" style={{ margin: 0 }}>ml</span>
          <button className="seclink" onClick={() => pick(c)} disabled={!c}>Save</button>
        </div>
        {err && <div className="sheet-err">{err}</div>}
        <div className="fhint">Changes what “Add a bottle” logs from now on. Past entries keep their amount.</div>
        <button className="sheet-cancel" onClick={onClose}>cancel</button>
      </motion.div>
    </motion.div>
  );
}

const SUPP_UNITS = ["tablet", "caps", "mg", "g", "IU", "ml", "scoop"];
// Add a supplement, or edit a logged one (editing, with its protein row as scoop).
function SupplementLog({ history: { names: history, last: lastDose, brand: lastBrand }, products, editing, scoop, onClose, onLogged }: {
  history: { names: string[]; last: Record<string, fd.Dose>; brand: Record<string, string> }; products: fd.SupplementProduct[]; editing?: fd.Supplement; scoop?: fd.LogItem; onClose: () => void; onLogged: () => void;
}) {
  const [name, setName] = useState(editing?.supplement_name ?? "");
  const [dose, setDose] = useState(editing?.dose_amount != null ? String(editing.dose_amount) : "");
  const [unit, setUnit] = useState(editing?.dose_unit ?? (editing && fd.isProteinPowder(editing.supplement_name) ? "scoop" : "tablet"));
  // Where the dose came from, while you haven't touched it: your last one, or a usual amount.
  const [doseFrom, setDoseFrom] = useState<"last" | "usual" | null>(null);
  const [touched, setTouched] = useState(false); // typed a dose or picked a unit: never auto-fill over it
  // A new dose on a past day starts at 09:00 that day, not at the clock's time now.
  const [time, setTime] = useState(() => editing ? clockOf(editing.logged_at) : isBackfill() ? "09:00" : clockOf(new Date().toISOString()));
  // Per scoop, protein powders only. An edit starts from what it was logged with.
  const perScoop = (v: number | null) => (scoop && scoop.grams > 0 && v != null ? String(Math.round((v * fd.SCOOP_G * 10) / scoop.grams) / 10) : "");
  const [protein, setProtein] = useState(() => perScoop(scoop?.protein_g ?? null));
  const [carbs, setCarbs] = useState(() => perScoop(scoop?.carb_g ?? null));
  const [fat, setFat] = useState(() => perScoop(scoop?.fat_g ?? null));
  const [kcal, setKcal] = useState(() => perScoop(scoop?.kcal ?? null));
  // What the last lookup found: where from, and whether it changed the numbers.
  const [found, setFound] = useState<{ ok: boolean; head: string; sub: string } | null>(null);
  const [filling, setFilling] = useState(false);
  const powder = fd.isProteinPowder(name);
  // The brand you take, mapped to its real label (a caffeine gum's mg per piece too). Not for protein powders (scoop lookup above).
  const savedFor = (n: string) => products.find((p) => p.name.trim().toLowerCase() === n.trim().toLowerCase());
  const [brand, setBrand] = useState(editing?.brand ?? ""); // an old row shows the brand it was logged with
  const [brandTouched, setBrandTouched] = useState(false); // typed a brand: choosing another name never replaces it
  const [look, setLook] = useState<{ key: string; state: "busy" | "found" | "miss" | "error"; found?: fd.FoundProduct } | null>(null);
  const mappable = brandable(name);
  const saved = savedFor(name);
  const brandKey = `${name.trim().toLowerCase()}|${brand.trim().toLowerCase()}`;
  const hasBrand = mappable && brand.trim().length >= 2;
  const foundNow = look?.state === "found" && look.key === brandKey ? look.found! : null;
  const sameBrand = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const savedNow = hasBrand && saved && sameBrand(saved.brand, brand) ? saved : null;
  // The name's first mapping also fills earlier logs of it that have no numbers; a brand switch never does.
  const firstMap = !saved || (saved.per_unit.length === 0 && sameBrand(saved.brand, brand));
  // What the label would hold for this dose: the fresh lookup, else the saved product's numbers.
  const labelNow = foundNow ?? (savedNow && savedNow.per_unit.length > 0 ? savedNow : null);
  const doseNum = dose.trim() && Number.isFinite(parseFloat(dose)) ? parseFloat(dose) : null;
  const askBrand = async () => {
    if (look?.state === "busy") return;
    const key = brandKey;
    setLook({ key, state: "busy" });
    const f = await fd.lookupSupplement(name.trim(), brand.trim());
    setLook({ key, state: f === "error" ? "error" : f ? "found" : "miss", found: f && f !== "error" ? f : undefined });
  };
  const num = (v: string) => parseFloat(v) || 0;
  const autoKcal = fd.kcalOf({ protein: num(protein), carbs: num(carbs), fat: num(fat) });
  const setScoop = (m: fd.ScoopMacros) => { setProtein(String(m.protein)); setCarbs(String(m.carbs)); setFat(String(m.fat)); setKcal(String(m.kcal)); };
  // The powder's saved per-scoop numbers beat ones derived back from a rounded log row.
  useEffect(() => {
    if (!editing || !fd.isProteinPowder(editing.supplement_name)) return;
    fd.getScoopMacros(editing.supplement_name).then((m) => { if (m) setScoop(m); }).catch(console.error);
  }, [editing]);
  // Pick a supplement: the dose fills in (your last one, else a usual amount) unless
  // you've typed one. Protein powder also recalls its per-scoop numbers.
  const choose = (n: string) => {
    setName(n);
    if (!brandTouched) setBrand(savedFor(n)?.brand ?? (fd.isCaffeinePill(n) ? lastBrand[n.trim().toLowerCase()] : undefined) ?? "");
    let filled = false;
    if (!editing && !touched) {
      // A powder only reuses a scoop/g dose: those are the units its protein row understands.
      const prev = lastDose[n.trim().toLowerCase()];
      const mine = prev && (!fd.isProteinPowder(n) || prev.unit === "scoop" || prev.unit === "g") ? prev : undefined;
      const usual = fd.defaultDose(n);
      const d = mine ?? usual;
      if (d) { setDose(String(d.amount)); setUnit(d.unit); setDoseFrom(mine ? "last" : "usual"); filled = true; }
      else if (doseFrom) { setDose(""); setDoseFrom(null); }
    }
    if (!fd.isProteinPowder(n)) return;
    if (!filled && (unit === "mg" || unit === "tablet")) setUnit("scoop"); // a filled dose keeps its own unit
    fd.getScoopMacros(n.trim()).then((m) => { if (m) setScoop(m); }).catch(console.error); // this powder's own numbers
  };
  // Fill the per-scoop numbers from the brand (Claude searches its label) or a photo of the tub's label.
  const labelIn = useRef<HTMLInputElement>(null);
  const nameIn = useRef<HTMLInputElement>(null);
  // The brand goes in the name. A bare "Whey protein" has nothing to look up yet.
  const generic = /^(whey|whey protein|protein|protein powder|casein|plant protein|mass gainer)$/i.test(name.trim());
  const short = name.trim().length > 30 ? `${name.trim().slice(0, 29)}…` : name.trim();
  const fill = async (file?: File) => {
    if (filling || !name.trim()) return;
    setFilling(true); setFound(null);
    try {
      const photo = file ? await fd.photoFromFile(file) : undefined;
      const r = await fd.parseMeal(photo ? `${name.trim()}, one scoop` : `${name.trim()}, 1 scoop`, photo);
      const d = Array.isArray(r) ? r.find((x) => !x.dose_mg) : undefined;
      if (!d) { setFound({ ok: false, head: "Couldn't find it", sub: "Type the numbers from the tub." }); return; }
      const g = d.grams.regular;
      const at = (v: number) => Math.round((v * g) / 10) / 10;
      const m = { protein: at(d.per100.protein_100), carbs: at(d.per100.carb_100), fat: at(d.per100.fat_100), kcal: Math.round((d.per100.kcal_100 * g) / 100) };
      const same = m.protein === num(protein) && m.carbs === num(carbs) && m.fat === num(fat) && m.kcal === num(kcal);
      setScoop(m);
      const site = ((d.basis ?? "").split(":")[0] || "the web").replace(/^www\./, "");
      const head = file || d.source === "label" ? "Read from your label" : d.source === "web" ? `Found on ${site}` : "No listing found, estimated";
      setFound({
        ok: d.source !== "estimate",
        head: `${head} · ${Math.round(g)} g scoop`,
        sub: same ? "Same as you had." : `Filled in ${m.protein} g protein · ${m.carbs} g carbs · ${m.fat} g fat · ${m.kcal} kcal.${d.source === "estimate" ? " Check it against the tub." : ""}`,
      });
    } catch (e) { console.error(e); setFound({ ok: false, head: "Couldn't read that", sub: "Type the numbers from the tub." }); }
    finally { setFilling(false); }
  };
  const pin = pinnedSheet(useVisibleViewport()); // sit on top of the keyboard, not behind it
  const pool = useMemo(() => [...history, ...fd.SUPPLEMENT_SUGGESTIONS.filter((s) => !history.includes(s))], [history]);
  const suggestions = useMemo(() => {
    const q = name.trim().toLowerCase();
    return (q ? pool.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q) : pool).slice(0, 8);
  }, [name, pool]);
  const [busy, setBusy] = useState(false); // one save at a time: a double tap must not add the protein twice
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try { await save(); onLogged(); } catch (e) { console.error(e); setBusy(false); }
  };
  const save = async () => {
    const when = atTime(logDate(), time);
    const parsed = dose.trim() ? parseFloat(dose) : NaN;
    const doseAmount = Number.isFinite(parsed) ? parsed : null;
    const doseUnit = doseAmount != null ? unit : null;
    const b = hasBrand ? brand.trim() : "";
    // An old row whose brand is unchanged keeps its OWN snapshot, rescaled to the new dose.
    const keepOwn = !!editing && sameBrand(editing.supplement_name, name) && !!b && !!editing.brand && sameBrand(editing.brand, b) && !!editing.nutrients?.length;
    let map: fd.SuppMap = null;
    let pending = false; // the product still has to be saved, after the row is
    if (keepOwn) {
      const pu = products.find((x) => x.id === editing.product_id)?.unit ?? null;
      map = { brand: b, product_id: editing.product_id, nutrients: rescaleNutrients(editing.nutrients!, editing.dose_amount, editing.dose_unit, doseAmount, doseUnit, pu) };
    } else if (b) {
      if (!foundNow && !savedNow && saved && saved.per_unit.length > 0) map = { brand: b, product_id: null, nutrients: null }; // another brand, no lookup: the product on file with numbers stays as it is
      else if (savedNow && !foundNow) map = { brand: b, product_id: savedNow.id, nutrients: scaleNutrients(savedNow.per_unit, doseAmount, doseUnit, savedNow.unit) };
      else { map = { brand: b, product_id: null, nutrients: null }; pending = true; }
    }
    // The log goes first. The product is saved after it, from the Log tap (not the lookup), and a failure there never undoes the log.
    let id: string;
    if (editing) { await fd.updateSupplement(editing, name.trim(), doseAmount, doseUnit, when.toISOString(), map); id = editing.id; }
    else id = await fd.logSupplement(name.trim(), doseAmount, doseUnit, when.toISOString(), map);
    if (pending) {
      try {
        const { product } = await fd.saveProduct(name.trim(), b, foundNow ?? { product: null, unit: PRODUCT_UNITS.includes(unit as ProductUnit) ? unit : "tablet", per_unit: [], source_url: null, note: null });
        await fd.attachProduct(id, product.id, scaleNutrients(product.per_unit, doseAmount, doseUnit, product.unit));
      } catch (e) { console.error(e); }
    }
    const p = num(protein);
    if (powder && p > 0 && (unit === "scoop" || unit === "g" || doseAmount == null)) {
      const scoops = doseAmount == null ? 1 : unit === "g" ? doseAmount / fd.SCOOP_G : doseAmount;
      await fd.logProteinScoops(name.trim(), scoops, { protein: p, carbs: num(carbs), fat: num(fat), kcal: num(kcal) || autoKcal }, when.toISOString());
    }
  };
  return (
    <motion.div className="sheet-bg" initial={{ backgroundColor: "rgba(0,0,0,0)", backdropFilter: "blur(0px)" }}
      animate={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)" }}
      exit={{ backgroundColor: "rgba(0,0,0,0)", backdropFilter: "blur(0px)" }} onClick={onClose} style={pin.overlay}>
      <motion.div className="sheet addfood" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 320 }} onClick={(e) => e.stopPropagation()} style={pin.sheet}>
        <div className="sheet-h">{editing ? "Edit supplement" : "Add supplement"}</div>
        <input ref={nameIn} className="finput" placeholder="Supplement — e.g. Creatine" value={name} onChange={(e) => choose(e.target.value)} autoFocus={!editing} />
        {suggestions.length > 0 && (
          <div className="fsug">{suggestions.map((s) => <button key={s} onClick={() => choose(s)}>{s}</button>)}</div>
        )}
        <div className="frow">
          <input className="finput grams" type="number" inputMode="decimal" placeholder="how much" value={dose} aria-label="how much you took"
            onChange={(e) => { setDose(e.target.value); setDoseFrom(null); setTouched(e.target.value.trim() !== ""); }} />
          <div className="uchips">{SUPP_UNITS.map((u) => <button key={u} className={`uchip ${unit === u ? "sel" : ""}`} onClick={() => { setUnit(u); setDoseFrom(null); setTouched(true); }}>{u}</button>)}</div>
        </div>
        <div className="fhint dosehint">{doseFrom === "last" ? "Same as last time. Change it if today was different."
          : doseFrom === "usual" ? "The usual amount. Change it to match your label."
          : "How many you took (1 tablet, 2 caps), or the amount on the label. Optional."}</div>
        {mappable && (<>
          {/* one tap: the field is the search; return on the keyboard searches too */}
          <form className="brandsearch" onSubmit={(e) => { e.preventDefault(); if (hasBrand) askBrand(); }}>
            <input className="finput" placeholder="Brand, e.g. HealthKart" value={brand} aria-label="brand" enterKeyHint="search"
              onChange={(e) => { setBrand(e.target.value); setBrandTouched(true); }} />
            <button type="submit" disabled={!hasBrand || look?.state === "busy"} aria-label="look up this brand's label"><SearchIcon /></button>
          </form>
          {/* one line under the field, never blank, so typing a brand never moves the sheet;
              after a search, the result card below takes its place */}
          {(!hasBrand || look?.key !== brandKey || look.state === "busy") && (
            <div className="scoopfill" style={{ minHeight: 34 }}>
              {!hasBrand ? <span>Add the brand, then search for its label.</span>
                : look?.key === brandKey && look.state === "busy" ? <span role="status">looking it up…</span>
                : !foundNow && savedNow && savedNow.per_unit.length > 0 ? <span>On file, per {savedNow.unit}: {nutrientSummary(savedNow.per_unit)}.</span>
                : <span>Tap search to look up its label.</span>}
            </div>
          )}
          {look?.key === brandKey && look.state === "found" && look.found && (
            <div className="scoopfound" role="status">
              <b>✓ {look.found.product ?? "Found"} · per {look.found.unit}</b>
              <span>{look.found.source_url && <a href={look.found.source_url} target="_blank" rel="noopener" style={{ color: "inherit", textDecoration: "underline" }}>{siteOf(look.found.source_url)}</a>} · {nutrientSummary(look.found.per_unit)}{look.found.note ? `. ${look.found.note}` : ""}</span>
              {firstMap && unitsTaken(doseNum, unit, look.found.unit) != null && <span>Earlier logs without numbers will use these too.</span>}
            </div>
          )}
          {look?.key === brandKey && (look.state === "miss" || look.state === "error") && (
            <div className="scoopfound miss" role="status">
              <b>{look.state === "miss" ? "No listing with the numbers found." : "Couldn’t look that up."}{savedNow && savedNow.per_unit.length > 0 ? " Keeping the label on file." : " It logs without them."}</b>
              {savedNow && savedNow.per_unit.length > 0 && <span>Per {savedNow.unit}: {nutrientSummary(savedNow.per_unit)}.</span>}
            </div>
          )}
          {labelNow && scaleNutrients(labelNow.per_unit, doseNum, doseNum != null ? unit : null, labelNow.unit) === null
            && <div className="fhint">The label is per {labelNow.unit}, your dose is in {unit}. It logs without nutrients; count {labelNow.unit === "tablet" || labelNow.unit === "caps" ? "tablets or caps" : `${labelNow.unit}s`} to include them.</div>}
        </>)}
        {powder && (<>
          <div className="per100 scoopmac">
            <span className="per100-h">per scoop</span>
            <label>protein<input type="number" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} aria-label="protein per scoop, grams" /></label>
            <label>carbs<input type="number" inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} aria-label="carbs per scoop, grams" /></label>
            <label>fat<input type="number" inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} aria-label="fat per scoop, grams" /></label>
            <label>kcal<input type="number" inputMode="decimal" placeholder={autoKcal ? String(autoKcal) : ""} value={kcal} onChange={(e) => setKcal(e.target.value)} aria-label="calories per scoop" /></label>
          </div>
          <div className="scoopfill">
            {filling ? <span role="status">looking it up…</span> : (<>
              {generic
                ? <button onClick={() => nameIn.current?.focus()}>add the brand to the name to look it up</button>
                : <button onClick={() => fill()} disabled={!name.trim()}>look up “{short}”</button>}
              <button onClick={() => labelIn.current?.click()} disabled={!name.trim()}>read label photo</button>
            </>)}
            <input ref={labelIn} type="file" accept="image/*" hidden onChange={(e) => { fill(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
          {found && (
            <div className={`scoopfound${found.ok ? "" : " miss"}`} role="status">
              <b>{found.ok ? "✓ " : ""}{found.head}</b><span>{found.sub}</span>
            </div>
          )}
          {!found && <div className="fhint">{(protein ? "Counts toward your day's macros. Saved for next time." : generic ? "Type the brand into the name, e.g. Whey protein – MuscleBlaze Biozyme. Or type the numbers from the tub." : "Look it up, read the label, or type the numbers from the tub.")}</div>}
        </>)}
        <div className="mealtime"><span>taken at</span><TimeField value={time} onChange={setTime} label="time taken" /></div>
        <button className="addbtn" onClick={submit} disabled={!name.trim() || busy}>{editing ? "Save" : "Log supplement"}</button>
        <button className="sheet-cancel" onClick={onClose}>cancel</button>
      </motion.div>
    </motion.div>
  );
}
