# CALIBEX — Sampler Spec (M1, build-ready)

The sampler decides **which items to show at each touchpoint**. It's the core capture mechanic:
you have a ~40-item pool but only ever see a few per touchpoint, rotated so the ritual stays
fresh and every item still gets fed over a rolling window. App-layer logic; reads `items`,
writes `item_sampler_state`.

## Principles (what the algorithm guarantees)
1. **Least-recently-served (LRS):** prefer items not shown recently → fresh rotation, no autopilot.
2. **Facet-stratified:** spread the sample across facets so you don't get 4 sleep items one day, 4 stress the next.
3. **Protective-pin (dinner):** every dinner sample includes — and opens on — a positive item, so the evening review is never an all-negative deficit sweep.
4. **Fixed anchors bypass sampling:** SQ1, HY1, RPE1, FD1 are always shown and don't consume a sampled slot.
5. **Coverage:** with the quotas below vs. pool sizes, every item cycles in within ~3–4 days at the busy touchpoints — comfortably under a 7-day staleness target — purely from LRS, no special-casing.

## State — `item_sampler_state`
One row per item: `last_shown_at` (NULL = never shown = maximally stale), `times_shown`.
Updated when an item is **presented** (distinct from answered/skipped, so the skip signal stays clean).

## Config
```
QUOTA = { breakfast:1, lunch:2, afternoon:3, post_workout:1, dinner:5 }   # sampled slots (excl. fixed anchors); lib/sampler.ts is the source of truth
MEAL_SLOTS = { lunch:1 }   # at most this many 'any_meal' items; the rest rotate through the touchpoint's own pool
WEEKLY = show ALL items where touchpoint='weekly_review' (6) + the weigh-in prompt — no sampling
PROTECTIVE_PIN_TOUCHPOINTS = { dinner }
MEAL_TOUCHPOINTS = { breakfast, lunch, afternoon, dinner }     # where 'any_meal' items are eligible
CONTEXT_SUPPRESS = {                                            # from day_context
    rest:   [AA1, AA2, AS1, AS2, RPE1],   # no planned training → training items + post-workout don't fire
    sick:   [AA1, AA2, AS1, AS2, RPE1],
    travel: [],                            # nothing suppressed (flag is for later stratification)
    normal: [],
}
```

## Algorithm
```
sampleTouchpoint(tp, wake_date, context):
    if tp == 'weekly_review':
        shown = allActiveItems(touchpoint='weekly_review')      # all 6, no sampling
        recordShown(shown); return shown

    # 1. eligible pool
    pool = items where active
             and (touchpoint == tp OR (touchpoint == 'any_meal' AND tp in MEAL_TOUCHPOINTS))
             and item_id NOT in CONTEXT_SUPPRESS[context]
             and (per_occurrence == true OR not answeredOrSkippedToday(item, wake_date))

    fixed      = [i in pool if i.fixed]          # always shown, NOT counted toward quota
    candidates = [i in pool if not i.fixed]
    q          = QUOTA[tp]
    selected   = []

    # 2. protective-pin (dinner): reserve the first slot for the stalest protective item
    if tp in PROTECTIVE_PIN_TOUCHPOINTS and exists(protective in candidates):
        selected += [ LRS(filter(candidates, is_protective)) ]

    # 3. fill remaining slots — facet round-robin + LRS within facet
    while len(selected) < q and unselected(candidates) not empty:
        facet = nextFacetRoundRobin(facets present in unselected(candidates))
        selected += [ LRS(unselected(candidates) in facet) ]

    # 4. order + record
    shown = fixedInDisplayOrder(fixed) + protectiveFirst(selected)
    recordShown(shown)                            # upsert last_shown_at = now, times_shown += 1
    return shown

LRS(set)  = item with the oldest last_shown_at (NULL sorts oldest);
            ties → lower times_shown → lower sort_order
staleness = days since last_shown_at (NULL → ∞)
```

## Per-touchpoint behaviour
- **breakfast:** fixed SQ1 + HY1, then 2 sampled from {SQ2, SQ3, SM1, SM2, NR1, NR2}. (~4 shown)
- **lunch:** 1 of the meal pair {NR1, NR2} + 1 from {NR4 skipped/late breakfast, SQ3 morning grogginess} (migrations 017–018, 2026-10-16; before that it asked the same pair daily). NR3 stays at dinner as a whole-day question.
- **afternoon:** 3 sampled from {AF1, AF3, SD1, SD2, SD3, PR1, PR2, NC1, NR1, NR2}.
- **post_workout:** fires **per session**, triggered by a manual **"Log a session"** button (WHOOP
  workouts don't reach the DB until the next-morning sync, so this can't be auto-triggered).
  Shows fixed RPE1 + 1 sampled from {AS1, AS2}. `occurrence` = (sessions logged today) + 1.
- **dinner:** fixed FD1, then 4 sampled from the dinner pool (~16 items incl. NR1/NR2), with **one
  protective slot pinned and shown first** (dinner protectives: AA1, RS4, CN1). (~5 shown)
- **weekly_review:** all 6 weekly items (LD3, LD4, LD5, SU1, SU2, SU3) + weigh-in. Fires once/week.

## Cold start (first ~week)
All `last_shown_at` = NULL → everything is "maximally stale" and ties resolve by `sort_order`. The
QUOTA cap still holds, so day 1 just yields QUOTA items per touchpoint in sort order; rotation
emerges naturally as history accrues. No special cold-start path needed.

## Per-occurrence handling
- **Per-session** (AS1, AS2, RPE1): each "Log a session" tap writes rows with an incrementing
  `occurrence`. The `(wake_date, item_id, occurrence)` unique index keeps each session distinct.
- **Per-meal** (NR1, NR2): eligible at every meal touchpoint; each write uses `occurrence` = meal
  number that day. They re-appear across meals (not blocked by "answered today").

## Edge cases
- **Already answered today** (non-per-occurrence): excluded from the pool — never re-shown same day.
- **Rest/sick day** (`day_context`): training items suppressed; the post-workout touchpoint simply
  doesn't fire (no "Log a session" expected).
- **Skipped item:** still counts as *shown* (state updated) — so a skip doesn't make it re-surface
  immediately, but the skip is recorded separately in `item_responses` as the missing-data signal.
- **Empty/thin pool** (e.g. lunch): show whatever's eligible, even if < quota. Never pad.
```
```
