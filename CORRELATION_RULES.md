# CALIBEX — Correlation Rules (pre-registration)

**Status:** DRAFT, 2026-10-13. Nothing here is locked until its section says *Signed off*.
**Change rule:** after a section is signed off, any edit gets a dated line in the Change log with the reason. A test's definition never changes after its data has been looked at; a changed test is a new test with a new id.

Why this exists: a test written after you've seen the data can be bent to fit it. These rules are fixed before the H1 data arrives, so a result means what it says.

---

## 1. Already in the code (`web/lib/stats.ts`)

| Rule | Value today |
|---|---|
| Baseline | Deviation from the median of the 28 days before (needs ≥14 of them); sleep midpoint deviations wrap circularly into ±12 h |
| Model | OLS on deviations, intercept + exposure + confounders |
| Effective sample size | n × (1 − ρ) / (1 + ρ), ρ = lag-1 autocorrelation of residuals |
| Error bars | The larger of Newey-West (HAC, Bartlett kernel) and a Bartlett long-run SE over 28 lags on the residualised exposure (`seForX`, 2026-10-17); non-finite results read "insufficient" |
| Gate | ≥30 effective days **and** ≥10 days in each arm (each band, for a 3-band test); sleep tests also need ≥5 drinking and ≥5 dry known days |
| Significance | α = 0.05 / (number of registered fitted contrasts), from `REGISTERED_TESTS` in code, never a literal. Today 12 → 0.05 / 12 ≈ 0.0042. Two-sided t on ESS − k df |
| Excluded days | travel / sick → every measure null; today → steps + strain null; rest days kept |
| Lags | Calendar-true (missing days are gaps, never "next available row") |

Sign-off: ☐ open (confirm this is the base every test inherits)

---

## 2. Test families and α

**Recommendation:** freeze families instead of one growing list.

| Family | Tests | α per test | Note |
|---|---|---|---|
| Fitted (WHOOP + drinking record) | H0a1, H0a2, H0d, H2a (2 contrasts × 3 outcomes), H2b (3 outcomes) | 0.05 / 12 ≈ 0.0042 | One family, the divisor read from `REGISTERED_TESTS`. H0a1/a2/d were registered after a first look at the data and carry the stricter bar on purpose (see change log). H2a/H2b registered 2026-10-17 before their results were seen. |
| H1 (your logs) | H1a, H1b | 0.05 / 2 = 0.025 | **Registered before data.** No effects fitted yet. Whether H1 joins the fitted family when its engine is built is open. |
| Retired | H0b, H0c | — | Retired 2026-10-17, no longer run or shown. Replaced by H2a / H2b, which measure different things, so new ids. |

- 2026-10-17: the earlier "H0 frozen exactly as coded" rule is withdrawn. Every fitted test shares one Bonferroni list, so adding a test tightens the rest, including H0a1, H0a2 and H0d whose results were already seen. Cost accepted: a seen finding can un-pass when a new test is registered.
- A changed test is still a new test with a new id; the old one is retired, not edited (H0b → H2a, H0c → H2b).
- Cost of two families (fitted + H1): about 10% chance of one false pass somewhere, against 5% for one list.

Sign-off: ☐ open

---

## 3. The registry

| ID | Exposure (night/day D) | Outcome | Confounders | Arms for the gate | Step reported |
|---|---|---|---|---|---|
| H0a1 | Strain vs normal | Recovery D+1 | Total sleep D+1 | ±2 strain | 2 strain |
| H0a2 | Strain vs normal | Recovery D+2 | Strain D+1, total sleep D+2 | ±2 strain | 2 strain |
| ~~H0b~~ retired | Bedtime vs normal (linear) | HRV that night | Strain D−1, total sleep | ±45 min | 1 hour |
| ~~H0c~~ retired | 7-night SD of sleep midpoint vs normal | Recovery | Total sleep, strain D−1 | ±15 min | 30 min |
| H0d | Steps below normal | Recovery D+1 | Strain D, total sleep D+1 | ±3,000 steps | 3,000 steps |
| **H2a** (best timing) | Middle of sleep vs usual, three bands: earlier ≤ −60 min, later ≥ +60, near usual otherwise. Usual = `normalAt` on the midpoint series, the Body clock's own. | Recovery, HRV, resting HR, that night (one contrast each: earlier vs near, later vs near) | Total sleep that night, strain D−1, drinking (wet = 1) | ≥10 nights in **each** of the three bands, ≥5 wet and ≥5 dry | the band's mean difference |
| **H2b** (is it harming you) | The Body clock's week figure (7-night median \|midpoint − usual\|, min 5 nights, `weekIrregularityAt`) as a deviation from its own 28-day normal | Recovery, HRV, resting HR, that night | Total sleep that night, strain D−1, drinking | ±15 min, ≥5 wet and ≥5 dry | 30 min more irregular |

H2a/H2b, registered 2026-10-17:
- Drinking status per outcome row (wake_date D): WHOOP journal "Have any alcoholic drinks?" answered on D → row D; dinner check-in AL1 answered on logging day W → row W+1 ('None' dry, anything else wet, skipped unknown); alcohol logged in Food on W → row W+1 (wet). Wet beats dry if sources disagree. **Unknown rows are excluded**, never assumed dry. Below 5 wet or 5 dry the test says so ("need 5 drinking days to separate drinking, have 3"); the column is never dropped.
- Resting HR: higher is the harmful direction; the headline reports "higher"/"lower" per outcome and the Finding carries `worse`.
- Through Oct 2026 the known-drink rows are Jul 2025 – Apr 2026 (the journal) plus the nights after Food-logged drinks. Recent nights count only once AL1 (migration 019) is live and answered.
| **H1a** | Dinner start vs your usual | HRV that night (wake D+1) | Alcohol that night (g), bedtime vs normal, strain D | Late: ≥45 min after usual · Comparison: at or before usual | 1 hour later |
| **H1b** | Standard drinks that night | Mean recovery deviation, mornings D+1 to D+4 | Strain D, weekend night (Fri/Sat) | Drinking nights · Dry nights | 2 standard drinks |

Definitions for H1a/H1b are in §4–§6. Sign-off: ☐ open

---

## 4. Definitions

**Dinner (H1a)**
- The earliest `food_log` row in slot `dinner` with an `eaten_at`. Later snacks don't move it.
- **Usual:** median of your logged dinners in the 28 days before (needs ≥7); your setup dinner time until then.
  - Change from code: today it's the all-time median. Rolling matches principle 4 and follows you if your routine shifts.
- **Comparison arm** is "at or before usual", not "≥45 min early". You rarely eat 45 min early, so the early arm would never fill. The regression still uses the full minutes value; arms only prove there's spread.

**Drinking night (H1b)**
- Exposure is **standard drinks** (alcohol g ÷ 10), not yes/no, so "1–2 vs 5+" shows up as a dose slope.
- Old bucket-only rows: bucket's low end (1–2 → 1, 3–4 → 3, 5+ → 5). Low on purpose (principle 3).
- Assumes the effect grows roughly in a straight line with drinks. If heavy nights behave differently, that's a later test, not a tweak to this one.

Sign-off: ☐ open

---

## 5. Lag: the alcohol curve

**Recommendation:** one test, one α slot.
- Primary outcome = **mean recovery deviation over D+1 to D+4** (needs ≥3 of the 4 mornings scored).
- **Clean episodes only:** a drinking night counts only if nights D+1 to D+3 are dry; a dry night counts only if D−3 to D+3 are all dry. Otherwise one night's hangover lands in another night's window.
- The day-by-day curve (D+1, D+2, D+3, D+4) is shown **only after the primary passes**, labelled "shape, not tested day by day".
- Cost of the alternative: four separate tests (one per day) would spend four α slots and cut each to 0.05 / 5.
- Cost of clean episodes: on a Fri + Sat weekend the Friday drops out (Saturday still counts if Sun–Tue are dry). Fills slower, but each result is about one night.
- **Weekend control, kept only if it can work:** it needs drinking nights on weekdays and dry Fri/Sat nights to compare. Rule, fixed now and decided from the drinking pattern alone (never the recovery results): keep "weekend night" only if there are ≥5 weekday drinking nights **and** ≥5 dry Fri/Sat nights when the test first reaches its gate. Otherwise drop it, and the result says "weekend not separated from drinking". If nearly all drinking is on weekends, the two can't be pulled apart by any method.

Sign-off: ☐ open

---

## 6. Confounders

- **Max 3 per test.** With a 30-effective-day gate that's about 6 effective days per estimated number. (The `k <= 4` note in `stats.ts` is a comment, not a solver limit.)
- **Mediators stay out.** Something the exposure *causes* is not controlled for, or it hides the effect.
  - H1b doesn't control sleep: alcohol wrecking sleep *is* the effect.
  - H1a **does** control bedtime, on purpose: H2a already measures sleep timing, so H1a asks "late dinner at the same bedtime". If you'd rather ask "late dinner and everything that comes with it", drop bedtime.
- **Each habit controls for the other** where they share a night: H1a includes alcohol grams.

Sign-off: ☐ open

---

## 7. Missing data

| Situation | Rule |
|---|---|
| No dinner logged | Missing for H1a. Not "no dinner". |
| Dry night | Counts only if **dinner was logged** that evening and no drinks. Food at breakfast alone doesn't prove you were logging that night. |
| WHOOP outcome missing | Pair dropped. |
| WHOOP recovery still calibrating | Outcome dropped (`cycles.recovery_calibrating`). H1+ only; H0 is frozen (§2). |
| Travel / sick day | Excluded from every test, as exposure and outcome (already how H0 runs). |
| Rest day | Kept. |
| Today | Never an exposure day (still in progress). |

- **Bias the engine can't fix:** drinking nights get logged more reliably than quiet ones. The dinner-logged rule shrinks this, it doesn't remove it. Results carry this note.

Sign-off: ☐ open

---

## 8. Scanning the 28 items

**Recommendation:** not in v1. When it comes:
- Called **Leads**, kept apart from Findings, never worded as a result ("worth testing", not "lowers").
- False-discovery-rate control (Benjamini–Hochberg, q = 0.10) across everything scanned.
- Only items with ≥30 answered days enter the scan.
- A lead becomes a finding only by being registered as a new test (H2+) and passing on **data collected after** it was registered.

Sign-off: ☐ open

---

## 9. How results read

| Status | Shown when | Wording |
|---|---|---|
| Not enough days | ESS < 30 or an arm < 10 | "12 of 30 effective days" / "need 10 late dinners, have 4" |
| Not clear | Gate met, range crosses 0 | "Enough days, no clear effect yet" |
| Clear but small | Range excludes 0, effect below the floor | "Real but small: about 2 points lower (1 to 3)" |
| Clear | Range excludes 0, effect at or above the floor | "Late dinner (1 hour): HRV about 6 ms lower that night (−10 to −2)" |

- **Floor (smallest effect worth calling out):** 3 recovery points, 3 ms HRV. Judgment call; below that it's within WHOOP's day-to-day wobble.
- Always an effect **with its range**, per the natural step (1 hour, 2 drinks). Never a correlation coefficient, never "causes".
- **Falling back:** status recomputes on every load, no memory and no smoothing. A finding that loses its range just reads "Not clear" again. Once ESS is well past 30 this is rare.
- "Averages, not causes" stays on Insights.

Sign-off: ☐ open

---

## 10. Where this differs from the original design notes

| Original notes say | Code / this doc | Recommendation |
|---|---|---|
| 14/30-day baselines | 28-day normal, ≥14 days | Keep 28. Update the design notes to match. |
| Alcohol: 4-day recovery curve | H1b counted next morning only | §5: 4-day mean, one test |
| Alcohol: dose buckets, "1–2 vs 5+" | H1b arms wet vs dry | §4: standard drinks as the exposure |

Sign-off: ☐ open

---

## Code changes these rules imply (next job, after sign-off)
1. H1 engine: fit H1a and H1b with `buildFinding`, own family α = 0.025.
2. `pendingTests`: rolling 28-day dinner usual; comparison arm "at or before"; dry night needs a logged dinner; clean-episode windows for H1b.
3. Standard drinks per night (grams, bucket low end for old rows).
4. Drop calibrating recoveries as outcomes in H1+ only. H0 untouched.
5. "Clear but small" status + floors.
6. Fix the `k <= 4` comment.

## Change log
- 2026-10-13: draft.
- 2026-10-13: weekend control made conditional on drinking pattern (weekend-only drinking would otherwise stall H1b).
- 2026-10-13: H0 frozen exactly as coded; the calibrating-recovery rule no longer applies to H0 (changing tests whose results are already known biases them).
- 2026-10-17: **H0b and H0c retired** (design decision). H0b measured bedtime as a straight line and H0c irregularity as a 7-night SD; the Body clock measures the night's *middle* against a usual, in bands, and a week's irregularity as the median absolute deviation, so the tests changed meaning and got new ids: **H2a** (three timing bands, earlier / near usual / later) and **H2b** (the card's week figure). Both run on recovery, HRV and resting HR and add drinking as a confounder from the WHOOP journal, AL1 and Food logs. Why drinking: with the drinking column added, the late-bedtime slope shrinks sharply, so the old linear-bedtime finding was mostly alcohol riding on late nights.
- 2026-10-17: **one Bonferroni family for every fitted test**, divisor from the registered list (12 today), replacing the literal 0.05 / 5 and the "H0 frozen" rule for α. H0a1, H0a2 and H0d get the stricter bar too, on purpose.
- 2026-10-17: the irregularity exposure is the week figure's deviation from its own 28-day normal (the §1 base rule), not the raw figure; the card's "this week vs usual week" reads the same way.
