# CUTIQ rebuild audit

Reviewed 12 November 2026. This describes the code found in this workspace and the
replacement implementation. Earlier root-level decision and redesign documents
remain historical references; this document and MODEL.md describe v2.

## What the original project was doing

CUTBOARD had grown from a 60-day tracker into a broad coaching app. A large App.jsx
owned authentication, onboarding, meals, recipes, nutrients, task planning, activity,
weekly reviews, photos, schedules and export. CutIQTab separately modeled body
composition, projected dates and recommended pace changes. WorkoutTab maintained
routines, live sessions, PRs and history. Supabase stored JSON values under per-user
keys, shared custom foods separately, and private photos in Storage.

The intended core was useful: record intake and weight, estimate maintenance,
prescribe a deficit and adapt as evidence arrives. Additional independently managed
rules made the final prescription difficult to follow.

## Findings and resolution

| Finding in archived code | Consequence | v2 decision |
| --- | --- | --- |
| App.getAdaptiveTDEE, buildDayPlan, CutIQTab's paceController, per-day snapshots, fasting and schedule rules all participate in prescriptions. | A recommendation and the operative food target can diverge; understanding precedence requires tracing several components. | One pure buildPlan function produces energy, macros, phase, status and projection for every view. |
| Active Cut adds configured cardio duration to expenditure before completed duration is checked. | The planned deficit can depend on an uncompleted walk. | Credit only steps actually entered above baseline. Final lower steps debit the baseline; an unfinished day remains provisional. |
| Extra steps are estimated in coaching text independently of the actual calorie target. | Moving more can produce advice without an equal food allowance. | A single signed activity adjustment is added identically to expenditure and target. |
| Initial maintenance uses broad activity multipliers while separate activity credits and measured TDEE also exist. | There is no clean definition of which movement is already included. | An explicit usual-step baseline and averaged training allowance define the reference condition. Calibrated expenditure is normalized to that condition. |
| App changes to maintenance when the cut's duration expires; the pace controller recognizes a body-composition goal separately. | Calendar expiration can end a cut before the goal, while a reached goal can still be handled by different rules. | A confirmed scale-weight trend or an explicit maintenance start controls phase. A missed deadline remains a visible review condition. |
| Maintenance adds about 150 kcal weekly from the cut target. | The user remains in a deficit while the UI calls the phase maintenance. | Return directly to estimated maintenance; protect calibration against transition water regain. |
| Existing intake estimation accepts meal presence as a signal and historical fasting can imply prescribed rather than measured intake. | A partial meal log or inferred zero can distort expenditure estimates. | Whole-day confirmation is required. Missing data is unknown; no fasting prescription or inferred fasting calories. |
| Body-composition inference uses assumptions about fat/lean fractions and strength. | Outputs can look more precise than the available measurements justify. | Target scale weight; no inferred body-fat or muscle-loss diagnosis. |
| Old store methods catch read failures and return null/empty arrays; callers can continue as though data is absent. | A failed load can resemble a fresh account. | Load errors block editing; failed saves retain the form. Reads and writes propagate errors. |
| Many independent per-key saves and hydrated snapshots. | Partial updates and stale state are difficult to reason about. | One versioned state document, compare-and-swap for cloud updates, stale-tab detection for local saves. |
| Multiple views could derive from different saved versus unsaved inputs. | A phase label, calorie preview and backup could disagree while editing. | One workspace owns the day draft and its computed plan; export includes unsaved day changes. Account changes mount a separate workspace. |
| Local-date helpers are repeated. | Calendar arithmetic and cut day numbering are easy to diverge. | One date-only utility; local today plus UTC calendar arithmetic, with leap/month-boundary tests. |

## Scope retained and removed

The active app has Today, Progress and Plan. It retains meal entry, the existing
vegetarian food library, weight trend, steps, a training check-in, profile settings,
account login, local-only operation when unconfigured and JSON export.

Fasting, zigzag/carb cycling, automatic cardio escalation, inferred body composition,
micronutrient coaching, task planning, progress photos and full workout logging are
outside the active app. The old source is preserved in `legacy/`; original account
rows, workout history, recipes and photo objects are untouched. There is no database
delete or reset in the new app.

Migration copies measurements and meal facts into a new `cutiq:v2` document. It
requires profile review, converts the old body-fat goal to a reviewable scale-weight
suggestion when possible, and marks imported food/activity days incomplete. It does
not import old targets, schedules or plan snapshots.

## Verification

Engine and migration tests exercise accounting invariants, step adjustments,
completion flags, deadline caps, goal confirmation, persistent maintenance,
historical isolation, weekly holds, calendar dates, calibration intervals, activity
normalization, missing data, macro budgets and non-destructive migration.

The isolated headless browser smoke test covers onboarding, an exact reference
prescription, extra steps, meals, final low steps, reload persistence, unsaved-form
protection, competing tabs, mobile overflow, goal-reaching drafts, maintenance and
draft export. It uses demo
storage in a new browser context, not an actual account. Screenshots are generated
under `artifacts/` and ignored by Git.

Build and lint must pass. Real account data has not been rewritten as part of
development; production authentication and RLS still require the existing Supabase
configuration. The schema is unchanged. The app has not been deployed.

A second headless integration test uses an account-mode production build with a
non-routable fixture backend. Every external request is intercepted. It verifies
the login flow, importing legacy rows, creating only the new v2 record, conditional
updates and retaining the draft after a simulated backend failure. This verifies
client behavior against a mock, not the live Supabase policies or service.

Final checks: 35 engine/migration tests, lint, production build, local browser smoke,
mock account integration and the dependency audit passed. No known dependency
vulnerabilities were reported by the audit at verification time.
