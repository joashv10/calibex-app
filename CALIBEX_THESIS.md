# CALIBEX — the fundae

**One instrument for your whole self.** Your body, your mind, your food, your training, your sleep, your stress — today all of it lives in different apps, sensors, and notebooks, and *none of them talk to each other*. CALIBEX pulls every domain into a single time-series and finds the **cross-domain, n-of-1 patterns** that only appear when body, mind, and behaviour finally sit in the same place.

It is a **measurement instrument**, not a wellness app — built first for one high-commitment quantified-self user, for the niche of the niche.

---

## Why it exists

Modern health is **fragmented by design.** Your recovery is trapped in a wearable. Your macros are in a food app. Your mood, stress, and headspace are nowhere — or in your memory, which lies. Your training is in a third app. So the questions that actually matter are *unanswerable*, because no tool holds the pieces together:

- Does my **mental state** wreck my **sleep**, or is it the other way round?
- Which **foods** move my **recovery** — and how many days later?
- Does a hard **training** block quietly raise my **stress** floor?
- What's the *real* cost of **alcohol** across the next four days, not just tomorrow?
- How do **body, mind, and fuel** actually feed into each other, for *me* specifically?

None of these can be answered by a single existing tool, because none of them connect the whole person. CALIBEX is built to be that one place — and then to do the statistics honestly on top of it.

## The origin (the catalyst, not the whole story)

The trigger was WHOOP. After ~250 days of committed journaling I burned out and realised the tools were the problem, not me. Two failures:

1. **High-friction logging** — a separate, dedicated daily step, forever, until you quit.
2. **Naive correlation** that can't separate the alcohol from the late dinner from the hard session, and that inflates confidence on autocorrelated data — manufacturing false "insights."

But fixing a wearable's journal was never the point. It just exposed the real gap: **nothing connects the whole person and reasons across it.** That is CALIBEX.

## The core idea

**Capture every domain with near-zero friction → store it as one honest time-series → run confound-aware, lagged correlations *across* domains.**

The domains, unified in one instrument (evidence-based, ACLM lifestyle-medicine framework): **nutrition, physical activity, restorative sleep, stress, risky substances, social connection** — joined to the wearable's biometrics (HRV, recovery, sleep, strain) that auto-sync in. The point isn't any single domain; it's the **interactions between them**, quantified for one specific body and mind.

---

## The non-negotiables (this is the real fundae)

1. **Friction is structural, not personal.** Logging stacks onto moments you already have — a meal, a workout, bedtime. Never a separate step. No streaks, no nags, no guilt. A skipped entry is silent missing data, never a penalty. Under two minutes a day.

2. **No 1–10 self-rating scales, anywhere.** Every subjective thing is a concrete behavioural/somatic anchor — "snapped at someone?", "jaw tense?", Yes/No or small buckets. Severity scales are smooth and self-referential; behavioural anchors are discrete, externally anchored, and statistically cleaner.

3. **Deviation from *your* baseline beats raw values.** A late dinner matters relative to your normal, not a clock. The engine works on rolling baselines and measures delta.

4. **Scores are computed, never stored.** Data stays item-level; the scoring model *will* evolve as data accumulates, so scoring lives in views that change without rewriting history.

5. **Statistical honesty over insight volume.** Time-series is autocorrelated: 60 logged days ≈ ~20 independent points. CALIBEX computes an *effective* sample size and **gates every insight** — below threshold it says "not enough signal yet," out loud. For a skeptical single user, one spurious insight destroys trust in the whole instrument. A tool that admits it doesn't know yet beats one that confabulates.

---

## How it works

- **Capture is touchpoint-driven:** a push-nudged daily timeline (breakfast / lunch / afternoon / post-workout / dinner). A deep pool of questions, but you only ever see ~3 sampled items per touchpoint — the ritual stays fresh while every domain keeps getting fed.
- **Biometrics auto-sync from the wearable.** CALIBEX owns all the *journalling*; the wearable is a pure sensor.
- **Everything joins on `wake_date`,** which encodes the wearable's N-1 offset (today's recovery reflects last night's behaviour) — so body, mind, food, and training all line up on the same day.
- **The engine** starts with the two highest-signal cross-domain hypotheses — dinner timing → next-morning HRV, and alcohol → the multi-day recovery curve — each with autocorrelation-corrected gating before anything is ever surfaced.

## What success looks like

A cross-domain pattern you could never hold in your head, that a simple engine could never isolate: *"your late dinners cost you two days of recovery," "your Sunday stress tracks Saturday's under-sleep," "this protein source vs. your body composition."* Surfaced only once the math is real.

> **It's the one instrument that connects your body, mind, food, and training — and finds what actually moves you, without lying to you about it.**
