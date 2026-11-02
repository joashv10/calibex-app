# Calibex

**One instrument for your whole self.** Calibex joins what you eat, how you train, how you sleep and how you feel to your WHOOP data. It's built to find what actually moves your recovery, and to say so when it can't tell yet.

**Live demo:** https://calibex-demo.vercel.app (a separate demo build with sample data)

<p>
  <img src="docs/screen-today.png" width="250" alt="Demo, Today: last night's recovery, the 14-day trend and the day's logging moments">
  <img src="docs/screen-food.png" width="250" alt="Demo, Food: the day's calories and macros, with meals logged by time of day">
</p>

## Why

Your recovery is trapped in a wearable. Your meals are in a food app. Your training is in a third. Your stress and mood are nowhere, or in your memory, which lies. So the questions that matter can't be answered:

- Which foods move my recovery, and how many days later?
- What does alcohol really cost me over the next few days?
- Does a hard training block quietly raise my stress?
- Does my mood wreck my sleep, or is it the other way round?

Calibex started after about 250 days of WHOOP journaling ended in burnout. Two things broke. Logging was a separate chore every day, forever. And the insights were simple correlations that couldn't tell the alcohol from the late dinner from the hard session. Calibex is built to fix both.

## What it captures

| Domain | How |
|---|---|
| **Food** | Type a meal, or photograph a pack label or screenshot. Packaged food is read from its label. Home dishes come from the Indian food composition tables (IFCT), or a deliberately low estimate. Covers calories, macros, fibre and sugar |
| **Training** | Sessions, lifts and how hard they felt, plus WHOOP workouts and strain (WHOOP's measure of how hard the day was on your body) |
| **Sleep** | WHOOP sleep and naps, plus how rested you woke |
| **Substances** | Alcohol (what and how much) and caffeine |
| **Mood and stress** | Quick, concrete questions, mostly yes/no, never 1–10 ratings |
| **Body** | WHOOP recovery, HRV (heart-rate variability, a stress and recovery signal) and resting heart rate, synced automatically |

**The questions are concrete,** so they can be measured cleanly. There's a pool of about 40, for example:

- *Snap at or feel short with someone?*
- *Tension headache, or catch yourself clenching your jaw, today?*
- *Still groggy or foggy an hour after waking?*
- *Give in to a strong craving today?*

## How it works

1. **Logging fits moments you already have:** waking up, meals, a workout. Each moment asks a couple of fixed questions plus a few sampled from the pool, so it stays fresh. No guilt for gaps: a skipped entry is just missing data.
2. **Everything lines up on one day.** Food, training, mood and WHOOP join on the wake date, so last night's dinner sits next to this morning's recovery.
3. **Your baseline, not a generic one.** Effects are measured against your own normal, a rolling 28-day median.
4. **Honest statistics.** Daily health data is autocorrelated: today looks a lot like yesterday, so 60 logged days can be worth only about 20 independent ones. Calibex works out that effective number and holds every result until it reaches 30. Until then it shows *"Not clear yet"* and how many effective days it has.
5. **No stored scores.** Data stays item by item, so the analysis can change without rewriting history.

## Status

In daily use by one person.

- **Running now:** on WHOOP history, tests of training strain and steps against next-day recovery, and of sleep timing.
- **Waiting for enough logged days:** the food and alcohol tests, such as dinner timing against next-morning recovery, and drinking nights against recovery.

## Privacy

Built for a single owner. In the owner's deployment, sign-ups are off, and the public database key reads nothing from any table. Both were checked on 2 Nov 2026. The private database key never reaches the browser. Test fixtures in this repo are synthetic.

## Stack

- **App:** Next.js 16, React 19 and TypeScript; an installable web app with push reminders (`web/`), on Vercel
- **Database and sign-in:** Supabase (Postgres, email one-time code, row-level security)
- **WHOOP sync:** Python scripts plus a signed WHOOP webhook
- **Food reading:** Anthropic API for meals, drinks and supplements

Deeper reading: [the thesis](CALIBEX_THESIS.md) (the full vision, ahead of the code) · [statistics rules](CORRELATION_RULES.md) · [instrument design](INSTRUMENT_DESIGN.md) · [question sampler](SAMPLER_SPEC.md) · [readout](READOUT_SPEC.md)

## Tests

264 tests in the web app (statistics, body clock, food reader, question sampler; 1 optional stress test is skipped by default), plus 5 Python tests.

```bash
cd web && npm ci && npm test
cd web && npx tsc --noEmit
# the build needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY set
cd web && npm run build
pip install -r requirements.txt && python3 -m unittest tests/test_wake_date.py
```

## Run your own copy

Calibex is single-user, so each person runs their own copy: their own Supabase project, WHOOP developer app and Vercel deploy. **The repo is not a one-step installer yet.** Some tables come from database migrations not included here, so treat the SQL as a reference for the data model.

<details>
<summary>Setup notes</summary>

Env var names only; see `.env.example` for where each one goes.

1. **Database.**
   - Run `schema.sql`, `calibex_v2_schema.sql` and `calibex_v2_seed.sql`, then the numbered migrations in order.
   - Run `create schema private;` before `008_owner_rls.sql`.
   - Not included: migrations 001–002, and the tables `food_log`, `foods`, `lift_log`, `lift_templates`, `meal_skips`, `push_subscriptions`, `saved_meals`, `exercise_favorites` and `session_log`.
   - **Turn on row-level security for every table yourself, including `whoop_auth` (it holds your WHOOP token).** The SQL here doesn't do it for all of them.
   - In `008_owner_rls.sql`, replace `you@example.com` with your sign-in email.
   - Turn off sign-ups and anonymous sign-ins in Supabase Auth after your first sign-in.
2. **App.** `cd web && npm install && npm run dev`. Needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `ANTHROPIC_API_KEY`. For push and sync, also `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `NUDGE_SECRET`, `WHOOP_CLIENT_SECRET`, `GITHUB_DISPATCH_TOKEN` and `GITHUB_REPO`.
3. **WHOOP.** Register an app at developer.whoop.com and set `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET` and `WHOOP_REDIRECT_URI`. Then `pip install -r requirements.txt` and run `python3 authorize_whoop.py` once.
4. **Scheduled jobs.** Sync and reminders run from the owner's private deployment, so no workflows are included. If you add your own, the secrets are `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC`, `VAPID_PRIVATE` and `VAPID_SUBJECT`. The secret named `SUPABASE_ANON_KEY` must hold the service-role key, because those jobs bypass row-level security. Keep it in Actions secrets, never in the browser.

</details>

## License

MIT
