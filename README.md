# CUTIQ / CUTBOARD

The familiar cutting dashboard with five tabs and one shared daily calorie model.

- **Today:** calorie ring, macros, coach, meals and food search, weight, sleep and steps. Saved totals count automatically.
- **Nutrition:** nutrients, food profiles, saved meals and recipe builder.
- **Progress:** a yearly diet/steps/sleep consistency heatmap with habit filters, streaks and daily details; weight/sleep/steps charts, measurements and private photos.
- **Cut IQ:** Calorie Strategy, projections, body-composition estimates, strength check-ins, pace and optional refeed advice.
- **Workout:** routines, live sets, rest timer, PRs and workout history.

Extra steps above the usual baseline earn **40 kcal per 1,000 steps**. A 2,000 kcal allowance becomes 2,200 after 5,000 extra steps; estimated expenditure rises by the same 200, preserving the planned net deficit. Schedule, fasting, zigzag and Active Cut have been removed from the active app. Old settings no longer affect the live allowance.

## Run

Use Node 20.19+ or 22.12+ for Vite 7.

```powershell
npm.cmd install
npm.cmd run dev
```

Account mode uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env.local`, with the existing Supabase schema and private photo bucket. No schema migration is needed. Use `supabase_schema.sql` for a new project; existing deployments retain their configuration.

For a separate local demo:

```powershell
$env:VITE_DEMO='1'
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

Demo edits persist under `cutboard:demo:v3` in this browser. Demo mode never signs in to a real account. For production, disable `VITE_DEMO` and configure Supabase. An explicit environment value overrides a local file.

## Checks

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:browser
npm.cmd run test:consistency
```

The browser check expects the demo server at port 5173 and uses a fresh headless Edge context. Set `BROWSER_CHANNEL` or `TEST_URL` if needed. Screenshots go to ignored `artifacts/`.

The consistency heatmap counts logged food within 5% of its calorie goal (with at least 75 kcal tolerance), logged steps at goal, and 7+ hours of logged sleep. No completion checkboxes are required, including for older logs whose switches were left off. Today updates while logging; its last saved values remain the day's totals. Empty days stay unknown. Captured daily goals stay attached to historical days. Older days without captured goals use the plan reconstructed for that date. An unfinished today does not break yesterday’s streak.

`npm.cmd run test:cloud` expects an account-mode production preview at port 5174. Build with `VITE_DEMO=0`, `VITE_SUPABASE_URL=https://cutiq-test.invalid` and `VITE_SUPABASE_ANON_KEY=fixture-key`, then run `npm.cmd run preview -- --host 127.0.0.1 --port 5174`. Every external request is intercepted; authentication and storage are fixtures. This does not test live RLS or modify real account data. `npm.cmd run test:accounts` uses the same preview with two separate fixture IDs and JWT-aware request checks; it exercises switching accounts during delayed reads/writes, profile conflicts and recovery of an interrupted edit.

## Code and data

`src/lib/planEngine.js` resolves the baseline, movement, fixed goal, phase, pace, projection and final plan from `modelInputs.js` validation. `cutEngine.js` retains pure trend, macro, calibration and advisory helpers; older controller exports are not active target setters. `App.jsx`, `CutIQTab.jsx` and `WorkoutTab.jsx` retain the original interface. `cloudData.js` handles scoped, ordered, revision-checked persistence; `compatData.js` bridges the temporary v2 document back into the original rows without rewriting data on load.

Original recipes, workouts, sleep, measurements and photos remain available. Conflicting old profile/day versions require visible review; a whole-document timestamp cannot silently select a profile. Identical facts preserve historical targets and classic-only fields survive. Account-bound stores and keyed workspaces isolate sessions; revision-checked writes and account-scoped recovery drafts protect interrupted edits. Original source is preserved under `legacy/`; the replaced interface is also preserved in Git history.

See [audit](docs/REBUILD-AUDIT.md) and [model/evidence](docs/MODEL.md). Software tests verify consistent accounting, not exact biological expenditure or guaranteed fat loss.

Cut IQ counts each date with saved food, steps or a weigh-in from the start of the cut, including today. It runs the first calorie review on the 14th logged date. Calorie Strategy shows how many days remain, a projected review date if you log daily, and separate food, step and weigh-in counts. If the first review needs better evidence, the app explains the gap and rechecks when records change. Once an estimate is accepted, weekly reviews can adjust maintenance by up to 100 kcal per review. The estimator matches food and steps between morning weigh-ins and can use well-covered stretches across a gap. Weak or stale evidence holds the previous allowance. Two slow reviews at the issued targets can lower the adaptive baseline by up to 100 kcal/day, followed by at least 14 days of observation. Fast loss or declining strength blocks reductions. Manual targets show the suggested change for review. Removing the duplicate Weekly Review card does not remove this automatic learning. A missed deadline does not end an unfinished cut; repeated goal-level weights transition it to maintenance. These are tested software behaviors, not a guarantee of individual fat loss or a completion date.
