# CALIBEX v1 — Instrument Design v2 (questions → facets → pillars)

Revised after round-2 stress-test. Key changes from v1:
- **NEW hard rule — Memorability.** Every item must reference something the user actually
  *encodes and can recall*: a salient event, an action with a consequence, or the *current*
  state at the moment asked. NOT fleeting internal micro-states ("is your jaw tense right
  now / was it tense at 2pm") or trivial slips ("re-read a sentence"). If the only way to
  answer is to guess, the item is cut. This retired the present-tense somatic body-scans
  (nocebo risk) AND their retrospective versions (unmemorable).
- **Nutrition moved off dinner** onto the meal touchpoints — answer about the meal you just
  photographed (current → memorable), not all-at-dinner.
- **Somatic & cognitive stress reworked** to memorable consequences / current evening state.
- Substances on an **absolute path** (no z-score). act_capacity **split**. Conditional items
  score **N/A**. Protective items scored **asymmetrically**. Quick-loggers for alcohol/caffeine.

---

## Design rules
1. **Concrete + memorable.** Behavioural/somatic referents the user can recall — no 1–10
   scales, no "vs normal" self-comparison, no fleeting micro-states.
2. **Item pools per facet** (≥2 interchangeable items) so rotation is valid.
3. **Valence balance** — every touchpoint pool carries an outward-pointing positive, so a
   sampled set is never a pure deficit-sweep.
4. **Context-aware** — items gate on rest/travel/no-session context (conditional → N/A).

## Scoring (settled)
- Item-level baselining → **trailing 7–14d window** → averaged to facet → facet_weight-weighted to pillar.
- **Partial-pooling cold-start:** shrink each item's mean/sd toward its facet pool until the
  item has ≥N observations; gate insights on *item maturity*, never a silent NULL or raw mean.
- **Protective items scored asymmetrically:** the good answer *reduces* strain; the absent
  answer is **neutral/excluded**, never max strain (so a normal solo day ≠ max social strain).
- **Conditional items = N/A** when their precondition is unmet (SM2 if didn't wake; AA* on
  rest days) — excluded from the facet aggregate, never scored 0.
- **Substances are OFF the z-path:** alcohol → absolute dose + a thresholded `is_drinking_day`;
  caffeine → logged *departure from usual* + lateness. A usual/none day = 0 by definition.
- **Facet scores only when ≥3 fills in the window.** Sampler = **least-recently-served**,
  facet-stratified, with a per-facet staleness ceiling.

## Three input categories
1. **Rotating items** — sampled soft-signals (below).
2. **Fixed anchor** — only **SQ1** (sleep), asked daily, one tap.
3. **Quick-loggers** — **alcohol** (pegs) + **caffeine** (cups + time, smart-default), logged
   only when they happen, feeding the Substances pillar from the `drinks` table.

---

## 1. NUTRITION  *(asked at the meal touchpoint — about the meal just logged)*
### facet `nutr_regulation`
| ID | Prompt | Type | Severity | Valence | Touchpoint |
|----|--------|------|----------|---------|-----------|
| NR1 | Eat past comfortable fullness? | bool | No 0 / Yes 1 | neg | per meal |
| NR2 | Eating this more for stress/boredom than hunger? | bool | No 0 / Yes 1 | neg | per meal |
| NR3 | Skip or significantly delay a planned meal today? | bool | No 0 / Yes 1 | neg | dinner (whole-day) |
### facet `nutr_cravings`
| ID | Prompt | Type | Severity | Valence | Touchpoint |
|----|--------|------|----------|---------|-----------|
| NC1 | Snacking or grazing between meals? | bool | No 0 / Yes 1 | neg | lunch/afternoon |
| NC2 | Give in to a strong craving today? | bool | No 0 / Yes 1 | neg | dinner (whole-day) |

## 2. PHYSICAL ACTIVITY
### facet `act_adherence`  *(dinner; conditional — N/A on no-planned-training days)*
| ID | Prompt | Type | Severity | Valence |
|----|--------|------|----------|---------|
| AA1 | Do the training you planned today? | bool | Yes 0 / No 1 | **protective** |
| AA2 | Skip or cut a planned session short? | bool | No 0 / Yes 1 | neg |
### facet `act_fatigue`  *(afternoon; current/noticed)*
| ID | Prompt | Type | Severity | Valence |
|----|--------|------|----------|---------|
| AF1 | Body feel heavy or sluggish today? | bool | No 0 / Yes 1 | neg |
| AF2 | Muscles sore or fatigued even at rest? | bool | No 0 / Yes 1 | neg |
| AF3 | Felt physically fresh with good energy today? | bool | Yes 0 / No 1 | **protective** |
### facet `act_session`  *(post-workout; fires once per logged session)*
| ID | Prompt | Type | Severity | Valence |
|----|--------|------|----------|---------|
| AS1 | Hit your planned weights / pace this session? | ord | Yes 0 / Partly 0.5 / No 1 | neg |
| AS2 | Felt strong and powered through this session? | bool | Yes 0 / No 1 | **protective** |

## 3. RESTORATIVE SLEEP
### facet `sleep_quality`  *(breakfast; current)*
| ID | Prompt | Type | Severity | Valence |
|----|--------|------|----------|---------|
| **SQ1** | How hard was it to get out of bed? | ord | Easy 0 / Normal 0.5 / Had to push 1 | neg · **FIXED ANCHOR** |
| SQ2 | Wake feeling rested? | bool | Yes 0 / No 1 | **protective** |
| SQ3 | Still groggy or foggy an hour after waking? | bool | No 0 / Yes 1 | neg |
### facet `sleep_maint`  *(breakfast; memorable gestalt — WHOOP carries objective awakenings)*
| ID | Prompt | Type | Severity | Valence |
|----|--------|------|----------|---------|
| SM1 | Was it a restless or broken night? | bool | No 0 / Yes 1 | neg |
| SM2 | Wake earlier than you wanted and couldn't get back to sleep? | bool | No 0 / Yes 1 | neg |
### facet `sleep_daytime`  *(afternoon)*
| ID | Prompt | Type | Severity | Valence |
|----|--------|------|----------|---------|
| SD1 | Nod off or fight to stay awake during the day? | bool | No 0 / Yes 1 | neg |
| SD2 | Need caffeine or a walk to get through afternoon sleepiness? | bool | No 0 / Yes 1 | neg |
| SD3 | Felt alert and clear-headed through the afternoon? | bool | Yes 0 / No 1 | **protective** |

## 4. STRESS  *(core soft-signal pillar — 3 facets, all evening/dinner)*
### facet `stress_somatic`  *(memorable consequences + current evening state — NO daytime scans)*
| ID | Prompt | Type | Severity | Valence |
|----|--------|------|----------|---------|
| TS1 | Tension headache or tight, aching neck/shoulders today? | bool | No 0 / Yes 1 | neg |
| TS2 | Jaw or temples sore from clenching/grinding? | bool | No 0 / Yes 1 | neg |
| TS3 | Felt wired or unable to wind down this evening? | bool | No 0 / Yes 1 | neg |
| TS4 | Felt physically relaxed and at ease this evening? | bool | Yes 0 / No 1 | **protective** |
### facet `stress_emotional`  *(whole-day)*
| ID | Prompt | Type | Severity | Valence |
|----|--------|------|----------|---------|
| TE1 | Snap at or feel short with someone today? | bool | No 0 / Yes 1 | neg · *→ soc_friction* |
| TE2 | Couldn't switch off or relax in your downtime? | bool | No 0 / Yes 1 | neg |
| TE3 | Things felt like they were piling up on you? | bool | No 0 / Yes 1 | neg |
| TE4 | Felt genuinely calm or content at some point today? | bool | Yes 0 / No 1 | **protective** |
### facet `stress_cognitive`  *(memorable consequences)*
| ID | Prompt | Type | Severity | Valence |
|----|--------|------|----------|---------|
| TC1 | Forget something that caused a problem today? | bool | No 0 / Yes 1 | neg |
| TC2 | Have to redo something because of a careless mistake? | bool | No 0 / Yes 1 | neg |
| TC3 | Felt mentally sharp and on top of things today? | bool | Yes 0 / No 1 | **protective** |

## 5. AVOIDANCE OF RISKY SUBSTANCES  *(quick-log only — no asked questions, absolute scoring)*
- **`subs_alcohol`** ← alcohol peg-logger (pegs/units + type). Severity from absolute dose;
  drives a thresholded `is_drinking_day`. Default None unless logged.
- **`subs_caffeine`** ← caffeine quick-logger (cups + last-cup time, pre-filled "your usual").
  Severity from departure-from-usual + lateness. A confirmed-usual day = 0.

## 6. SOCIAL CONNECTION  *(dinner)*
### facet `soc_connection`
| ID | Prompt | Type | Severity | Valence |
|----|--------|------|----------|---------|
| CN1 | Have a meaningful or enjoyable interaction today? | bool | Yes 0 / No *neutral* | **protective** (asymmetric) |
| CN2 | Turn down or avoid a social plan today? | bool | No 0 / Yes 1 | neg · *→ stress_emotional* |
### facet `soc_friction`
| ID | Prompt | Type | Severity | Valence |
|----|--------|------|----------|---------|
| FR1 | Draining conflict or tense exchange with someone? | bool | No 0 / Yes 1 | neg |
| FR2 | Felt let down or frustrated by someone? | bool | No 0 / Yes 1 | neg |

---

## Touchpoint distribution
| Touchpoint | Pool | Notes |
|---|---|---|
| **breakfast** | SQ1*(fixed)*, SQ2, SQ3, SM1, SM2 + NR1/NR2 (about breakfast) | show SQ1 + ~2 |
| **lunch** | NR1/NR2 (about lunch), NC1 | light; piggybacks meal photo |
| **afternoon** | SD1, SD2, SD3, AF1, AF2, AF3, NC1, NR2 (snack) | show ~3 |
| **post-workout** *(per session, training days)* | AS1, AS2 | fires once per logged session |
| **dinner** *(the day's "evening review")* | AA1, AA2, TS1–4, TE1–4, TC1–3, CN1, CN2, FR1, FR2, NR3, NC2 | show ~4–5, facet-stratified |

Plus the two quick-loggers (alcohol, caffeine) surfacing quietly at dinner.

## Counts
- Rotating items: ~30 across 12 asked facets. 0 single-item facets. ~9 protective.
- Substances: 0 asked items (2 quick-loggers). Somatic: 0 present-tense scans.

---

## ⚠ Known open tension (for stress-test)
**Dinner still carries ~6 facets** (act_adherence, 3× stress, 2× social + 2 nutrition whole-day
items). Memorable whole-day items naturally resolve at end-of-day, and dinner is the only
reliable evening touchpoint — so de-crowding it fully isn't possible by rewording alone.
Current plan: treat dinner as a deliberate ~60–90s "evening review", keep ≤4 items/facet,
sample ~4–5 with least-recently-served stratification, lean on partial-pooling so sparse
items still score. **Open question:** is that viable, or do we need a separate lightweight
**bedtime** micro-touchpoint to absorb the somatic/wind-down items (more accurate there, and
de-bottlenecks dinner) at the cost of one more daily firing?

## Open decisions
1. Memorability rework of somatic/cognitive — are the new items genuinely recall-accurate?
2. Dinner load — evening-review vs. add a bedtime touchpoint (above).
3. Shared items (TE1→friction, CN2→emotional) — fractional weight vs drop.
