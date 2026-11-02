"use client";
// Body clock, the full screen: sleep regularity, this week against your usual,
// the 7-night strip, the supporting rows, and what the sleep tests say (H2a best
// timing, H2b harm), run exactly as Insights runs them. Opened from the card on Insights.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ensureAuth } from "@/lib/data";
import { wakeDate } from "@/lib/day";
import { fetchCycles, getDrinkRows, getExcludedDays, type Cycle } from "@/lib/readout";
import { cachedSettings, getSettings } from "@/lib/settings";
import { drinkStatus, excludeDays, runH0, type DrinkRows } from "@/lib/stats";
import { FOOTNOTE, HarmBlock, Hero, LoadError, Rows, StaleNote, Strip, TimingBlock, useBodyClock, WeekLine } from "../BodyClockParts";

export default function BodyClockPage() {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [skipDays, setSkipDays] = useState<string[]>([]);
  const [drinkRows, setDrinkRows] = useState<DrinkRows>({ journal: [], al1: [], substances: [] });
  const [tz, setTz] = useState(() => cachedSettings()?.tz || "Asia/Kolkata");
  const load = useCallback(async () => {
    await ensureAuth();
    let ok = true;
    const [cy, se, sk, dr] = await Promise.all([fetchCycles().catch((e) => { console.error(e); ok = false; return [] as Cycle[]; }), getSettings(), getExcludedDays(), getDrinkRows()]);
    setFailed(!ok); setCycles(cy); setSkipDays(sk); setDrinkRows(dr);
    if (se?.tz) setTz(se.tz);
    setLoading(false);
  }, []);
  useEffect(() => { load().catch((e) => { console.error(e); setLoading(false); }); }, [load]);
  const bc = useBodyClock(cycles, tz);
  // Same exclusions and drinking status as Insights, so the two screens never disagree.
  const drinks = useMemo(() => drinkStatus(drinkRows), [drinkRows]);
  const findings = useMemo(() => (cycles.length ? runH0(excludeDays(cycles, skipDays, wakeDate()), tz, drinks) : []), [cycles, skipDays, tz, drinks]);

  if (loading) return <div className="center">loading…</div>;
  return (
    <main className="app">
      <div className="body">
        <div className="topbar">
          <Link href="/insights" className="back">‹ Insights</Link>
          <span className="brand"><span className="logomark" aria-hidden />BODY CLOCK</span>
          <span style={{ width: 48 }} />
        </div>
        {failed ? <section className="pt"><LoadError /></section> : !bc ? <section className="pt"><p className="pt-empty">Still learning. Body clock starts once WHOOP has recorded your sleep.</p></section> : (
          <>
            <section className="pt bc"><Hero bc={bc} /><WeekLine bc={bc} /><StaleNote cycles={cycles} tz={tz} />{bc.thisWeek.value !== null && <Strip nights={bc.strip} />}</section>
            <div className="sec-h"><span>Your rhythm</span><span>last 28 nights</span></div>
            <section className="pt bc"><Rows bc={bc} /></section>
            <section className="pt bc"><TimingBlock findings={findings} /></section>
            <section className="pt bc"><HarmBlock findings={findings} /></section>
            <p className="pt-cap">{FOOTNOTE}</p>
          </>
        )}
      </div>
    </main>
  );
}
