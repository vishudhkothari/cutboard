# CUTIQ restoration and logic audit

Reviewed 12 November 2026. This supersedes the earlier stripped-down rebuild. The current scope is the original layout and features with stronger accounting and persistence. The active interface was restored from commit `315b04e`; `legacy/` remains an untouched original-source reference.

## What the application does

The app combines daily food and activity logging, nutrition analysis, weekly progress reviews, body-composition estimates, cutting advice, schedules, private photos, and workout routines/live sessions. Original Supabase accounts store per-user JSON keys in `user_data`, shared custom foods in `shared_foods`, and photos in private Storage. The original six tabs are all active again.

## Findings and corrections

| Finding | Current behavior |
| --- | --- |
| Different surfaces recalculated the target independently. | `planEngine.getPlanForDate` resolves the final food target for Today, Nutrition, Schedule and historical reviews. Cut IQ uses the same calibrated baseline estimate. |
| Extra steps produced coaching advice without an equal food allowance. | A single 40 kcal/1,000-step coefficient adjusts both expenditure and food above the configured baseline. |
| Planned incline minutes earned calories before completion. | Only logged minutes earn food; estimated overlapping steps are subtracted once. |
| Activity multipliers, gym and extra credits could overlap. | The original activity multiplier represents the usual routine, including gym and baseline steps. Workouts do not earn another calorie credit. Learning normalizes intake to this same baseline. |
| Zigzag floor clipping changed the weekly total. | The pattern redistributes clipped calories so its integer weekly total equals seven times the baseline target. Movement is added afterward. |
| Fasting could erase meals or replace actual intake with prescribed fasting calories. | The toggle retains all meals. Learning uses actual meal totals, including meals on fasting days. A fasting override can undo a scheduled fast. |
| Captured snapshots froze today's budget; reconstructed history was written on load. | Today stays live. Captured past prescriptions remain fixed; reconstructed history can be corrected. Loading data does not rewrite it. |
| Calendar expiry and goal attainment were conflated. | Both can end the cut, preserving the original cut-window feature. The reason is tracked; a deadline does not prove goal attainment. Confirmed scale goals can end it earlier. |
| Maintenance was a prolonged reverse-diet deficit. | The planned deficit becomes zero immediately. Initial transition water changes are excluded from recalibration. |
| Strength check-ins could imply diagnosed muscle loss. | The feature remains, with explicit estimate/risk language. Reports sort numerically, deduplicate weeks and require consecutive weeks. Workout history updates reach Cut IQ immediately. |
| Read failures resembled empty accounts. | Profile/history failures block loading with Retry. They do not trigger empty onboarding or writes. |
| Racing writes or stale devices could replace newer values. | Writes are serialized per user/key and use revisions. Stale writes fail visibly. Pending log retries use the latest payload; account identity cannot redirect a draft. |
| The temporary v2 document hid original features and data. | A read-only bridge restores newer factual edits while retaining classic-only fields. New classic saves take precedence over the older document. Recipes, workouts and photos use the original stores. |

## Scope and preservation

Today, Nutrition, Progress, Cut IQ, Schedule and Workout retain their original components, theme, responsive layout and controls. Recipes, custom foods, fasting, zigzag, Active Cut, strength check-ins, refeed advice, body-composition estimates, measurements, photos and exports remain. A scale-weight goal is supported alongside the original body-fat goal. The original optional task-planner helper remains preserved; its lack of placement in the original six-tab UI is unchanged.

The earlier replacement components are removed from the active import graph, preserved locally under `rebuild/` and in Git history. User-authored documents in the project root are outside this change.

## Verification and limits

Unit coverage checks the 40 kcal rule, equal food/expenditure changes, floors, zigzag totals, fasting overrides, snapshot behavior, weekly reviews, deadline limits, maintenance, actual-intake calibration, missing data, compensation, strength weeks and data restoration. Storage tests cover account scope, pagination beyond 1,000 rows, ordered writes, stale revisions and read-only bridging.

Isolated browser checks cover meals/reload, fasting without data loss, completed incline and overlap, Active Cut, zigzag, nutrition/recipe builder, measurements/photos controls, strength check-in, workouts, profile edits and all six tabs on desktop/mobile. A production-mode test intercepts every external request and checks auth, data restoration, save failures/retries and read failures/retries.

No real account data was modified during testing. Live Supabase policies, live photo uploads and deployed behavior still depend on the existing service configuration. Estimates cannot guarantee an exact deficit, body composition or completion date.
