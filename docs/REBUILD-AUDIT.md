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

Historical compensation uses captured allowances; unknown historical prescriptions do not invent calorie debt. This also avoids repeatedly replaying the full learning model for each past day during an input edit. Profile saves recompute from current in-memory facts instead of fetching over pending edits.

## Validation

Meaningful checks include energy invariants, ignored retired settings, final/partial steps, food floors, macro energy, past snapshots, weekly holds, missed deadlines, goal confirmation, complete-day gates, aligned intake, outliers, noisy data, bounded convergence, baseline changes, account scope and preserved records. An idealized multi-month simulation verifies feedback under a deliberately wrong starting TDEE, without claiming biological validation.

Browser checks cover the retained food, recipes, measurements, photos controls, strength and workout flows; completion toggles; absence of Schedule and retired controls; the moved live strategy; manual-to-adaptive mode; profile saves; legacy scale-goal restoration; and desktop/mobile layout. Cloud tests use intercepted fixture authentication and storage to exercise read/write failures, retries and sign-out flushing. No real account data is modified by the tests.

See [model/evidence](MODEL.md) for equations, assumptions and outcome limitations. Software correctness can be tested; guaranteed fat loss, precise calorie expenditure and exact completion dates cannot.
