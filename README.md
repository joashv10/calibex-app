# Calibex

A personal health measurement and correlation instrument. It joins a wearable's biometrics
(WHOOP: HRV, recovery, sleep, strain) with low-friction daily logging (meals, drinks, caffeine,
supplements, training, a rotating handful of behavioural yes/no questions) and runs
confound-aware, lagged correlations on the result. Every insight is gated on an effective
sample size that accounts for autocorrelation, so it says "not enough data yet" instead of
inventing a pattern.

Single-user by design: one owner account, row-level security on every table.

Product thesis: [CALIBEX_THESIS.md](CALIBEX_THESIS.md). Statistics: [CORRELATION_RULES.md](CORRELATION_RULES.md).
Specs: [INSTRUMENT_DESIGN.md](INSTRUMENT_DESIGN.md), [SAMPLER_SPEC.md](SAMPLER_SPEC.md),
[READOUT_SPEC.md](READOUT_SPEC.md), [CUE_ONBOARDING_SPEC.md](CUE_ONBOARDING_SPEC.md), [PRD.html](PRD.html).

## Stack

- **App:** Next.js 16 (App Router) + React 19 + TypeScript, installable PWA with web push, in `web/`. Deployed on Vercel.
- **Database and auth:** Supabase (Postgres, email one-time-code sign-in, row-level security). SQL in the repo root.
- **Wearable sync:** Python scripts (`authorize_whoop.py`, `sync_whoop.py`, `import_whoop*.py`) run on a schedule from the owner's private deployment
  and triggered by a WHOOP webhook (`web/app/api/whoop/webhook`).
- **AI:** Anthropic API for meal, drink and supplement estimation (`web/app/api/*`).

## Setup

Env var names only; see `.env.example` for where each one goes.

1. **Database (not a complete from-scratch install yet).** Create a Supabase project and run `schema.sql`, `calibex_v2_schema.sql`,
   `calibex_v2_seed.sql`, then the numbered migrations in order. This is not enough on its own: migrations 001-002 are not included,
   and the `private` schema (including `private.is_owner()` and the reminder functions) plus tables the app uses (`food_log`, `foods`,
   `lift_log`, `lift_templates`, `meal_skips`, `push_subscriptions`, `saved_meals`, `exercise_favorites`) and the `push_status` function
   come from Supabase migrations that are not in this repo. Treat the SQL here as reference for the data model, not a working installer.
   In `008_owner_rls.sql` replace `you@example.com` with the email you will sign in with, and turn off sign-ups and anonymous
   sign-ins in Supabase Auth after your first sign-in.
2. **App.** `cd web && npm install && npm run dev`. Needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `ANTHROPIC_API_KEY`; for push and sync also `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `NUDGE_SECRET`, `WHOOP_CLIENT_SECRET`,
   `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`.
3. **WHOOP.** Register an app at developer.whoop.com, set `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI`, then run
   `python3 authorize_whoop.py` once to seed the refresh token. `pip install -r requirements.txt` first.
4. **GitHub Actions** (workflows are not included in this repo: scheduled sync and nudges run from the owner's private deployment). If you add your own, the secrets used are `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC`,
   `VAPID_PRIVATE`, `VAPID_SUBJECT`. The secret named `SUPABASE_ANON_KEY` is used by server-side jobs that must bypass
   row-level security, so it must hold the Supabase service-role key. Keep it in Actions secrets only, never in the browser.

## Tests

```bash
cd web && npm test         # statistics, body clock, food reader, sampler
cd web && npx tsc --noEmit && npm run lint && npm run build
python3 -m unittest tests/test_wake_date.py
```
Test fixtures are synthetic.
