# CALIBEX — Cue Contract & Onboarding Spec (M1, build-ready)

Closes the two adherence-blocking gaps the pre-build review found: the **reminder vacuum** and
the **cold-start void**. Designed by the CALIBEX CPO.

## The governing rule
> **Cue the *moment*, never the *person*. State, not summons. A glance, not a guilt-trip.**

The founder burned out on WHOOP's journal because the reminder carried a **debt** (a streak to
protect, a score that went gray on a miss) — not because it reminded him. So CALIBEX keeps the
neutral half of a reminder ("this moment is open") and bans the debt half entirely.

---

## (A) THE CUE CONTRACT — two mechanisms, tiered

### 1. The glanceable queue — an always-on widget (the spine, zero push)
A **home-screen + lock-screen widget** showing today's touchpoints as a quiet state strip:
`breakfast ✓  lunch ✓  afternoon ·  session +  dinner ·`
- **State, not score:** `✓` logged · `·` open · (absent) not-yet-due. Open is neutral charcoal — **never red/amber**. No "items remaining" count, no %.
- **Pull, not push:** it never notifies. It sits there; he sees it when already on his phone (which, at a meal, he is).
- **Deep-links into the touchpoint:** tapping the dinner dot opens *the dinner sampler* directly — one tap from lock screen to logging.
- **Resets silently at the 4am `wake_date` cutoff:** yesterday's open dots just vanish. No roll-over, no backlog, no residue. *This is the structural anti-guilt guarantee — the surface cannot show a backlog because backlogs don't exist.*

### 2. Exactly TWO pushes, fired at window-END (the safety net)
Only the two load-bearing touchpoints get a push; firing at window-*end* means a punctual log auto-suppresses it.

| Push | When | Why it earns one |
|---|---|---|
| **Dinner review** | once, at end of the configured dinner window (e.g. 9:15pm) — only if dinner isn't already logged | Heaviest touchpoint; the spine of the daily record. |
| **"Did you train?"** | once, late-afternoon/evening, **only on days a session is detected/expected** — silent on rest days | Post-workout can't be WHOOP-triggered in real time (sync lag); recovers sessions without mid-workout stops. |

**Hard cap: 2 pushes/day, both fired at window-end, both independently toggleable off** (pure-widget zero-push is a supported config). Breakfast / lunch / afternoon / per-session get **NO push** — they ride the widget + the meal/training habit.

### The contract (show verbatim in onboarding + settings)
> **CALIBEX will cue you in exactly these ways, and no others:**
> 1. A **silent widget** showing which of today's touchpoints are still open. It never notifies — tap a dot to log.
> 2. **One evening reminder** for your dinner review — only if you haven't already logged it.
> 3. **One reminder to log a training session**, on days you trained — never on rest days.
>
> **CALIBEX will never:** keep a streak · show how many days you missed · turn anything red for being late · send more than two reminders a day · guilt you for a skip. A skipped entry is silent missing data. Nothing is owed.

**Why it honors the wound:** no streak (widget shows today only, forgets at 4am) · no guilt (cues an open moment, never an accrued failure; a diligent day is a *silent* day) · survives a bad day (ignore everything → next morning clean slate, zero residue, cost = exactly one day of missing data, which is the intended behaviour).

---

## (B) ONBOARDING — ~4.5 min, ends on his own data

Lead with the carrot (use the **WHOOP cycles already synced to the DB**), then collect only what the app can't run without; defer the rest.

- **Step 0 · The hook (~30s, 0 taps).** First screen after WHOOP auth = **their own recovery sparkline from the synced history**, rendered immediately + one line: *"CALIBEX is the layer WHOOP is missing: what you DID, next to what your body did about it."* Kills the void before he logs anything.
- **Step 1 · Touchpoint windows (~90s).** The one thing the sampler/widget/pushes all need. Pre-filled sensible IST defaults (breakfast 8:00, lunch 13:00, afternoon 16:30, dinner 20:30, wind-down 22:30 = the 4am-boundary anchor). Accept-as-is = 0 taps. The dinner window here schedules the dinner push.
- **Step 2 · Usual dinner / FD1 default (~60s).** Set baseline composition + time once → every normal dinner becomes a one-glance confirm, not a log. Highest-value step for daily friction.
- **Step 3 · 1–2 goals (~60s, skippable).** Type alone is enough to anchor the main screen; **target value/date optional**. (10K time / body-comp / lift PR / recovery / custom.)
- **Step 4 · Contract + add widget (~30s).** Show the verbatim contract + an **[Add the widget]** deep-link to the OS install flow. Push permission asked *here only*, framed as "for your two daily reminders"; denial is fine (widget works without it). Never block onboarding on a permission.
- **Per-touchpoint explainers fire LAZILY** — one dismissible line the first time he hits each touchpoint, not 5 tutorial screens up front. Learn-by-doing.

---

## (C) WHAT NOT TO BUILD
**Cue layer:** ❌ per-touchpoint notifications (the nag shape) · ❌ app-icon badge counts (a debt object) · ❌ snooze / "remind me later" · ❌ catch-up/backlog surfaces ("you missed yesterday") · ❌ ML/geofenced smart-timing · ❌ afternoon push (ship without; revisit from M2 data).
**Onboarding:** ❌ guided tour of all items/touchpoints · ❌ required goal targets · ❌ day-1 weigh-in (rides the first weekly review) · ❌ any axes/Foster/scoring/experiments explanation · ❌ permission hard-gate.
**Defer past MVP:** widget richness (keep it a dumb state-strip), adaptive cue timing, onboarding for Experiments/Playbook/Goals-progress.

---

## (D) VERDICT & the one risk to instrument
**Day-60 survivable: yes.** It kills the void (Step 0 sparkline + the readout) and the forgot-it-exists failure (widget), *without* re-importing guilt (every cue evaporates at 4am — there is nothing to fall off of).

**Biggest residual risk: the "widget gamble"** — the whole cue layer leans on a passive widget being glanced-at often enough, backed by only two pushes. If the widget gets buried, breakfast/lunch/afternoon adherence quietly erodes.
**M2 kill-criterion (instrument this):** track **per-touchpoint fill-rate** in the shakedown. If a push-less touchpoint drops below ~50% fill, the answer is **never "add nags"** — it's either (a) add that one end-of-window push, or (b) cut that touchpoint's items as not-worth-the-friction. The shakedown resolves the gamble with data, not argument.
