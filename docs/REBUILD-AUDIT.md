# CUTIQ simplification and robustness audit

Updated 12 November 2026. The original interface remains the basis. The latest requested change removes Schedule and its Active Cut, fasting and diet-regime dependencies. Calorie Strategy now sits at the top of Cut IQ in the original card style. The remaining navigation is Today, Nutrition, Progress, Cut IQ and Workout.

## Removed active dependencies

- Schedule component, navigation entry, settings state, storage reads, save handlers and recapture handlers.
- Active Cut onboarding controls, date overrides, completed-incline UI and incline calorie credits.
- Fasting toggles, zero/25% allowance branches and fasting-specific calendar/coaching behavior.
- Zigzag patterns, weekly distribution math and regime displays.

Saved account rows, meal facts, photos, workouts and historical captured prescriptions are retained. Removed code remains in `legacy/` or Git history. A stored retired flag cannot influence a new live target. Loading an account does not rewrite or erase its old settings.

## Robustness corrections

The previous version had consistent extra-step accounting but still had important limits: calendar expiry could end an unfinished cut, plausible legacy meals could count as complete intake, missing later data could discard a learned baseline, and permanent correction bounds could prevent convergence from a large formula error.

The active model now requires explicit whole-day food and final-step records for learning, rejects isolated scale errors/noisy windows, applies bounded weekly updates and holds learned corrections when later data is missing. Repeated reliable weeks can gradually correct a large initial error. A missed deadline continues a bounded cut and flags review. Goal confirmation requires a multi-reading mean and majority, preventing one low outlier from ending the cut.

Manual calorie overrides are identified clearly and can return to adaptive mode. Intake-floor limitations are visible. Nutrition adherence uses complete days and a range around the target; severe under-eating is not rewarded as on-target. Refeed advice cannot treat partial food or above-plan intake as evidence of a fully adherent plateau. Calorie advice directs users to the shared operative target.

All calorie-debt and overeating-to-step compensation has been removed. Captured allowances are retained only for historical display; a retired fasting target cannot create a future movement prescription. Saved fitness goals are bounded by the configured maximum and usual steps plus 4,000. Profile saves recompute from current in-memory facts instead of fetching over pending edits.

## Validation

Meaningful checks include energy invariants, ignored retired settings, final/partial steps, food floors, macro energy, past snapshots, weekly holds, missed deadlines, goal confirmation, complete-day gates, aligned intake, outliers, noisy data, bounded convergence, baseline changes, account scope and preserved records. An idealized multi-month simulation verifies feedback under a deliberately wrong starting TDEE, without claiming biological validation.

Browser checks cover the retained food, recipes, measurements, photos controls, strength and workout flows; completion toggles; absence of Schedule and retired controls; the moved live strategy; manual-to-adaptive mode; profile saves; legacy scale-goal restoration; and desktop/mobile layout. Cloud tests use intercepted fixture authentication and storage to exercise read/write failures, retries and sign-out flushing. No real account data is modified by the tests.

See [model/evidence](MODEL.md) for equations, assumptions and outcome limitations. Software correctness can be tested; guaranteed fat loss, precise calorie expenditure and exact completion dates cannot.

## Second-account investigation and model version 5

Confirmed reproductions in the prior code included a BF-derived scale goal moving as logs accumulated, saved step goals bypassing their maximum, old fasting targets creating compensation debt, and old original/v2 profiles being selected by a whole-document timestamp. Numeric-string records and histories outside the active cut also reached different UI calculations. An old maintenance marker could end an unfinished cut without supporting weigh-ins. Sunday measurement edits could copy an older Sunday's food/weight/steps into a missing current Sunday and replace the day open in Today.

The active engine now returns one validated profile, scoped evidence, fixed goal, phase, budget, movement goal, pace and projection. RMR uses one Mifflin prior; body-fat and strength estimates do not change an explicit goal's energy budget. Missing weights hold an evidenced review rather than tightening food daily. Uneven weigh-in spacing is normalized by actual time. Measurement saves use the factual record for that exact Sunday, keep unmeasured fields empty and preserve recorded outliers rather than writing inferred copies back.

Each signed-in workspace and store is bound to an immutable account ID and is remounted on auth changes. Pending callbacks cannot populate the new account's state. Reads and writes use that ID, auth is checked again before queued writes, and photo operations check the private account folder. Write revisions are captured when edits enter the queue; a later read cannot authorize an earlier stale draft. Unread keys use an insert rather than overwriting an unseen row.

The v2 bridge remains read-only. Reviewed original profiles win. Conflicting older profiles require a visible review in the existing editor rather than a silent merge. V2-only profiles require review of missing assumptions such as usual activity. Conflicting day facts remain visible but cannot drive weight/activity/calibration until confirmed in Today. Identical imported facts preserve captured historical allowances. The full JSON export includes the legacy document, model version, local date/time zone and the resolved budget/goal/phase/calibration diagnostics so a reported result can be replayed.

Daily log drafts are copied locally under the account ID and date before the debounce. An acknowledgement clears only its exact payload, so an earlier response cannot erase a newer unsaved edit. Interrupted drafts are presented for comparison and explicit restoration after reload/sign-in; they never silently overwrite a cloud revision. Export includes unsynced drafts. Photo/shared-food read failures are surfaced rather than represented as an empty collection.

## Verification boundary

Unit and isolated browser fixtures reproduce the failure paths above. `test:accounts` uses two genuinely different IDs, profiles and private records through production auth/store code, with JWT-aware fixture RLS, delayed old-account reads/writes, cross-tab auth changes, migration conflicts, numeric strings, retired fasting history, future/pre-cut records, private routines/photo-folder reads and interrupted-edit recovery. `test:cloud` covers revision-checked persistence, failures, retries and sign-out flushing. `test:browser` covers retained flows, Sunday measurement integrity and desktop/mobile layouts.

These fixtures do not contain Adarsh's live records and do not validate the deployed Supabase RLS configuration. No live account data was accessed or repaired during this investigation: the local workspace lacks live account configuration, computer-use tools could not initialize, and the discovered Vercel deployment requires login. The user's specific wrong output has not yet been supplied. The fixes address reproduced defects; verification of Adarsh's exact case remains outstanding until a concrete result/profile/log export is available.
