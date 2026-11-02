# CALIBEX — Readout + Day-Boundary Spec (M1, build-ready)

The readout screen is the **#1-risk mitigation**: through the ~4-week silent phase it's the only
reason to come back, so it must feel like a *pulse*, not a static table. It shows your inputs next
to the recovery they produced — raw, honestly co-located, no computed score. This spec also pins
the `wake_date` day-boundary rule, which **every write depends on**, not just the readout.

---

## 1. The day-boundary rule (shared — used by ALL writes)
Every logged response, substance event, and measurement needs the right `wake_date`. A dinner tap
at 11pm and a "couldn't get back to sleep" tap at 1:30am belong to the **same waking day**, so the
boundary is NOT midnight.

**Rule — 4am local cutoff:**
```
wake_date = (local_now.hour < 4) ? (local_date − 1) : local_date
```
- `answered_at` / `event_at` store the true timestamp; `wake_date` is the derived bucket.
- This aligns behavioural logs with WHOOP's `wake_date` keying (the morning you woke).
- **Timezone:** derive from device-local time. On travel, set `day_context = 'travel'` so the few
  boundary-ambiguous days are flagged for later exclusion/stratification — don't over-engineer TZ
  for MVP. Implement as ONE shared helper so it's identical everywhere.

---

## 2. The readout join (behaviour ↔ recovery) — the N-1 offset
Behaviour during `wake_date D` → the recovery that reflects it is the morning of **`wake_date D+1`**
(design principle: "recovery on day N reflects behaviour from day N-1"). So:

> **`item_responses[D]`  pairs with  `cycles.recovery[D+1]`.**

The `v_readout` view (in `calibex_v2_schema.sql`) does this LEFT JOIN.

## 3. The "pending" state
The **newest** day's behaviours have no recovery yet — it arrives after tonight's sleep + tomorrow's
02:30-IST sync. So `cycles[D+1]` is NULL for today. Show **"Recovery syncs tomorrow morning,"**
never a blank or mis-paired number. (This is why the LEFT JOIN, not an inner join.)

---

## 4. Screen composition (make it a pulse, not a table)
- **Header sparkline** — last 7 days of `recovery_score` (raw, from `cycles`). A glanceable trend so
  the screen reads as "a story I'm building," not "a row."
- **Runway line** — `"N days logged · M to first signal"` (N = distinct `wake_date`s with ≥1
  answered item; M = days to the ~28-day observational mark). Reframes the silent month as visible
  progress toward something.
- **Timeline (newest first)** — one row per behaviour-day:
  - date + `day_context` chip (travel / sick / rest) when not normal
  - that day's recovery = the **D+1** morning value (or **"pending"** for today)
  - a compact glyph strip of what was logged (answered count; negatives flagged), tap to expand the
    full answers
  - **co-located substance events** (alcohol / caffeine from `substance_log`) on the same row — so
    *"recovery sat low the 3 days after that drinking night"* is visible to the naked eye
- **No computed score. No streak. No insight claim.** Raw data, side by side.

## 5. Why this stays honest (statistical-honesty principle)
It surfaces only raw WHOOP numbers + raw logs, co-located. No correlation is computed, no gate is
violated — the pattern-spotting is *yours*, with your own eyes. It's a direct, honest preview of
the Playbook's value without pretending to calculate it during the silent phase.

## 6. Supporting view
`v_readout` (display reshaping, NOT scoring — allowed at MVP): per behaviour-day, the answered/skipped
counts joined to the next-morning recovery. The app pulls per-item detail + substance events
separately for the expandable rows.
