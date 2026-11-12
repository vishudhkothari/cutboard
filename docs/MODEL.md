# CUTIQ model and evidence

Updated 12 November 2026. Model version 5 uses one validated daily plan for energy, goal, phase, pace and projection across the interface. Schedule, fasting modes, Active Cut, incline calorie credits and zigzag distribution are removed from the active calculation and interface. Historical records and old captured prescriptions remain intact.

## What is exact, and what is estimated

Software accounting is exact apart from rounding:

```
estimated expenditure = baseline maintenance + extra-step credit
food allowance = baseline food target + the same extra-step credit
planned deficit = estimated expenditure - final food allowance
```

The chosen coefficient is **40 kcal per 1,000 steps above the usual baseline**. A 2,000 kcal allowance becomes 2,200 after 5,000 extra steps. If baseline expenditure is 2,600, the plan is 2,800 minus 2,200: the same 600 kcal deficit. This coefficient is a product choice, not a measurement. The [2024 Compendium](https://pacompendium.com/walking/) and [walking-energy research](https://pubmed.ncbi.nlm.nih.gov/26679617/) describe variation with body mass, pace, grade and walking economy.

A partial low count does not debit food. Explicitly final lower counts do. An old count without completion metadata stays unfinished; neither the clock nor a missing flag can turn it into final activity. Historical captured allowances still display as recorded. Missing counts are unknown. The food floor takes precedence; the displayed deficit always uses the final allowance. Gym is already part of usual activity and does not receive another credit. Removed incline and diet settings cannot alter the current plan.

## Baseline and bounded targets

Initial resting energy uses [Mifflin-St Jeor](https://pubmed.ncbi.nlm.nih.gov/2305711/) consistently for adult profiles. An explicit scale goal makes body-fat readings advisory: uncertain visual/BIA readings no longer select another energy equation or change the deficit ceiling. The familiar activity multiplier represents the usual routine, including gym and steps at its saved reference. These are starting estimates, not measured expenditure. [Primary validation research](https://pubmed.ncbi.nlm.nih.gov/23631843/) supports Mifflin as a useful prior while reporting individual error; it does not establish accuracy for every user.

`activityReferenceSteps` anchors that routine estimate. Existing profiles default to their saved usual steps; a profile save preserves the reference. Changing usual steps shifts baseline expenditure by 40 kcal per 1,000 relative to the reference, while the daily extra-step credit uses the new baseline. Reclassifying the same completed movement therefore cannot drop it from estimated expenditure or count it twice. The same normalization preserves learned evidence. An activity-level, age, height or sex change restarts calibration; changing advisory BF or relabeling steps does not.

Weekly review weight uses the median of at least three valid measurements in a recent seven-day window; otherwise the last evidenced review or starting weight holds. Remaining weight and calendar time at that review imply a requested deficit using 7,700 kcal/kg. Missing new weights cannot tighten a budget by themselves. A scale-weight goal takes precedence; a BF fallback is calculated once from starting weight and starting BF, rounded to 0.1 kg. Daily inferred lean mass, strength reports and re-anchors never move the goal. This approximation is not the full dynamic NIH model. [NIDDK's planner](https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner) provides the relevant dynamic context.

Automatic deficits are capped by 25% of estimated baseline expenditure, 0.75% body weight/week, and the 1,500 male / 1,200 female food floor. These are product limits, not universal clinical safety thresholds. An infeasible timeline is flagged. A manual food override remains fixed until cleared; Calorie Strategy makes this explicit and offers Use adaptive target.

Protein and macro allocation use the final food allowance. Protein retains the original dynamic default and bounds. [Garthe et al.](https://pubmed.ncbi.nlm.nih.gov/21558571/) supports the direction of avoiding unnecessarily fast losses in trained athletes; [Longland et al.](https://pubmed.ncbi.nlm.nih.gov/26817506/) supports higher protein with resistance exercise within its studied population. Neither establishes a guaranteed individual result.

## Learning from results

Today always exposes whole-day food and final-step confirmations. Missing confirmations are unknown, including legacy logs. Calibration requires actual complete records rather than assuming a meal entry represents a full day.

Learning is reviewed weekly, beginning no earlier than day 28. [Hall and Chow's primary study](https://pmc.ncbi.nlm.nih.gov/articles/PMC3127505/) illustrates why repeated weights over extended periods are needed and why fluid shifts around diet changes limit precision. The following coverage and update thresholds are product assumptions rather than a validated clinical estimator. The first seven cut days are excluded. A trailing window of up to 28 days needs at least eight valid weights spanning 14 days. Intake is aligned from the first morning's date up to, but excluding, the final morning's date. Each interval day must have complete food, final steps, valid calorie values and a recorded step count. No missing day is invented as zero intake. Known zero intake is usable only when explicitly confirmed; a very low average intake window does not calibrate the model.

A robust initial weight slope and median residual check exclude isolated scale errors; at least 75% of weights and eight measurements must remain. A noisy window or implausible loss rate is rejected. These statistical thresholds are engineering assumptions, not clinical validation. Recorded weights are not deleted.

Baseline expenditure is inferred from actual intake minus step credit minus weight slope times 7,700. Signals outside 65-150% of the formula are withheld for review. Each accepted weekly correction moves halfway toward the observed estimate, with a maximum 100 kcal change relative to the previous learned baseline, plus the formula's weight-related drift. Repeated reliable weeks can correct an initial formula error beyond a fixed permanent 20% bound.

Reviews are replayed deterministically from records. Missing or noisy later data holds the learned correction instead of resetting to the formula. The same evidence window is not repeatedly applied during a maintenance water hold. Changes to the underlying resting-energy/activity assumptions restart learning. Systematic underlogging, changing activity and water shifts still limit what this estimator can infer; it cannot identify a personalized step coefficient independently.

## Timeline and maintenance

Passing the deadline does **not** declare the goal achieved. A bounded cut continues at a moderate requested rate and flags the timeline for review. The app does not escalate the deficit through a near-zero remaining-days calculation. If the intake floor prevents a planned deficit, this is shown rather than forcing further restriction.

Goal confirmation requires at least three weights within seven days after the first cut week, with the mean at/below goal and a majority of measurements at/below goal. One anomalous low weight cannot end the cut. Once confirmed, the planned deficit becomes zero immediately. Historical goal-confirming evidence survives ordinary rebound; an unsupported old `maintenanceSince` flag cannot declare completion. Changing goal/start settings starts a new confirmation period. No additional profile write races with daily logging.

Calibration holds pre-maintenance evidence during the first four maintenance weeks; later windows exclude the first 14 transition days. There is no mandatory slow reverse-diet ramp. The preliminary [2025 randomized reverse-dieting study](https://pmc.ncbi.nlm.nih.gov/articles/PMC12381988/) did not establish a significant regain advantage for a mandatory ramp.

## Input quality and pace

Dates must be real calendar dates. Profile and log numeric strings are normalized before any arithmetic or display; null and blank values are unknown, not zero. Invalid profiles or incoherent routine/energy assumptions show the existing profile editor with a reason and no invented calorie budget. Invalid optional records stay in storage and are excluded from inference. Pre-cut and future records cannot establish current goal completion, pace or calibration. Before a planned cut starts, today's food and movement still display at estimated maintenance.

Pace, Progress's live verdict and the projection use the same recent evidence. They need three weights in each recent seven-day window, at least ten calendar days of observed span, and a cut age of at least fourteen days. The difference between weekly means is normalized by their actual mean observation dates; uneven logging cannot turn an eleven-day change into a seven-day rate. Missing or stale weights do not establish a plateau. A positive rate below the planning ceiling supports an illustrative projection; flat/gaining, excessive rates and unconfirmed goal-level means withhold a completion date. Scenario dates are not statistical confidence intervals.

## Limits and verification

Pace, composition, strength and refeed features remain advisory. A strength dip does not measure muscle loss. Optional refeed advice requires complete food and appropriate intake adherence, and is not a promise of faster loss. Calorie Strategy remains the operative target.

Tests verify accounting, evidence gates, fixed goals, input normalization, date scoping, missing-data holds, outliers, gradual calibration, deadlines, snapshots, maintenance, account isolation and interrupted-save recovery. An idealized energy-balance simulation checks recovery from a deliberately overestimated TDEE and progress beyond a missed deadline. It is a software regression test under specified assumptions, not a clinical trial or biological guarantee. Actual expenditure, logging accuracy, water weight, body composition and completion date cannot be guaranteed by this app.
