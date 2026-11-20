# CUTIQ model and evidence

Updated 20 November 2026. Model version 8 uses one validated daily plan for energy, goal, phase, pace and projection across the interface. Saved values count without daily confirmation switches. The duplicate Progress Weekly Review card is removed; automatic weekly calorie learning remains active in Cut IQ. Schedule, fasting modes, Active Cut, incline calorie credits and zigzag distribution are removed from the active calculation and interface. Historical records and old captured prescriptions remain intact.

## What is exact, and what is estimated

Software accounting is exact apart from rounding:

```
estimated expenditure = baseline maintenance + extra-step credit
food allowance = baseline food target + the same extra-step credit
planned deficit = estimated expenditure - final food allowance
```

The chosen coefficient is **40 kcal per 1,000 steps above the usual baseline**. A 2,000 kcal allowance becomes 2,200 after 5,000 extra steps. If baseline expenditure is 2,600, the plan is 2,800 minus 2,200: the same 600 kcal deficit. This coefficient is a product choice, not a measurement. The [2024 Compendium](https://pacompendium.com/walking/) and [walking-energy research](https://pubmed.ncbi.nlm.nih.gov/26679617/) describe variation with body mass, pace, grade and walking economy.

A recorded step count is used as entered, including lower-than-usual counts and zero. No final-step switch is required. Today updates whenever the count changes, and the last saved count remains the day's total. Missing counts are unknown. Historical captured allowances still display as recorded. The food floor takes precedence; the displayed deficit always uses the final allowance. Gym is already part of usual activity and does not receive another credit. Removed incline and diet settings cannot alter the current plan.

## Baseline and bounded targets

Initial resting energy uses [Mifflin-St Jeor](https://pubmed.ncbi.nlm.nih.gov/2305711/) consistently for adult profiles. An explicit scale goal makes body-fat readings advisory: uncertain visual/BIA readings no longer select another energy equation or change the deficit ceiling. The familiar activity multiplier represents the usual routine, including gym and steps at its saved reference. These are starting estimates, not measured expenditure. [Primary validation research](https://pubmed.ncbi.nlm.nih.gov/23631843/) supports Mifflin as a useful prior while reporting individual error; it does not establish accuracy for every user.

`activityReferenceSteps` anchors that routine estimate. Existing profiles default to their saved usual steps; a profile save preserves the reference. Changing usual steps shifts baseline expenditure by 40 kcal per 1,000 relative to the reference, while the daily extra-step credit uses the new baseline. Reclassifying the same completed movement therefore cannot drop it from estimated expenditure or count it twice. The same normalization preserves learned evidence. An activity-level, age, height or sex change restarts calibration; changing advisory BF or relabeling steps does not.

Weekly review weight uses the median of at least three valid measurements in a recent seven-day window; otherwise the last evidenced review or starting weight holds. Starting weight, goal and duration set the initial deficit using 7,700 kcal/kg. Remaining weight and time inform the deadline warning. Weekly food decisions carry forward the issued baseline. A scale-weight goal takes precedence; a BF fallback is calculated once from starting weight and starting BF, rounded to 0.1 kg. Daily inferred lean mass, strength reports and re-anchors never move the goal. This approximation is not the full dynamic NIH model. [NIDDK's planner](https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner) provides the relevant dynamic context.

Automatic deficits are capped by 25% of estimated baseline expenditure, 0.75% body weight/week, and the 1,500 male / 1,200 female food floor. These are product limits, not universal clinical safety thresholds. An infeasible timeline is flagged. A manual food override remains fixed until cleared; Calorie Strategy makes this explicit and offers Use adaptive target.

Protein and macro allocation use the final food allowance. Protein retains the original dynamic default and bounds. [Garthe et al.](https://pubmed.ncbi.nlm.nih.gov/21558571/) supports the direction of avoiding unnecessarily fast losses in trained athletes; [Longland et al.](https://pubmed.ncbi.nlm.nih.gov/26817506/) supports higher protein with resistance exercise within its studied population. Neither establishes a guaranteed individual result.

## Learning from results

Saved food and step values are authoritative. Existing `foodComplete` and `activityComplete` switches cannot block ordinary logs. The user is responsible for honest full-day intake logging; the app does not request a second daily sign-off. Empty meal lists, measurements-only records, absent steps and invalid facts remain unknown. A previously explicit zero-intake record is preserved. Actual disagreements between imported facts still require conflict resolution, but differences in retired completion metadata do not create a conflict.

The initial learning phase lasts 14 distinct logged dates, including the first week and today. A date with saved food, steps or a morning weight counts once. Empty dates do not advance progress. Calorie Strategy shows independent totals for each type of record across the cut. The first review runs on the 14th logged date even between weekly reviews. Its projected date assumes logging on every remaining day. If the evidence is insufficient, the initial phase is complete and Cut IQ explains why the estimate is being held. It rechecks with new or corrected evidence. After the first accepted estimate, regular weekly reviews resume once at least seven days have elapsed since that estimate.

Each estimate uses a trailing window of up to 28 calendar dates. It needs at least eight usable morning weights across at least 14 inclusive dates. The latest weight must be at most three days old. Fourteen dates supply thirteen overnight intervals. Food and steps on the final morning's date count toward logging progress and enter the estimate with a later morning weight. Each interval uses recorded food and steps. These coverage thresholds are product assumptions. Fluid shifts limit the precision of estimates from repeated weights. [Hall and Chow](https://pmc.ncbi.nlm.nih.gov/articles/PMC3127505/)

A robust initial weight slope and median residual check exclude isolated scale errors; at least 75% of weights and eight measurements must remain. A noisy window or implausible loss rate is rejected. These statistical thresholds are engineering assumptions, not clinical validation. Recorded weights are not deleted.

Within each uninterrupted stretch, cumulative intake minus cumulative step credit minus 7,700 times the change in morning weight is fitted against elapsed days. Each stretch has its own intercept and the stretches share a slope, the baseline expenditure estimate. The fit requires matched intake and movement for at least 75% of the observed intervals, eight matched weights and a recent supported endpoint. In a 14-date window that requires at least ten of the thirteen intervals. Gaps are listed and excluded. Signals outside 65-150% of the formula are withheld for review. Each accepted correction moves halfway toward the observed estimate, with a maximum 100 kcal change relative to the previous learned baseline, plus the formula's weight-related drift. Repeated reliable weeks can correct an initial formula error beyond a fixed permanent 20% bound.

Reviews are replayed deterministically from records. Missing, stale or noisy later data holds the learned correction instead of resetting to the formula. Calorie Strategy explains the hold and identifies missing food/step dates when relevant. The same evidence window is not repeatedly applied during a maintenance water hold. Changes to the underlying resting-energy/activity assumptions restart learning. Systematic underlogging, changing activity and water shifts still limit what this estimator can infer; it cannot identify a personalized step coefficient independently.

## Timeline and maintenance

Passing the deadline does **not** declare the goal achieved. The existing weekly food review continues and flags the timeline. The app does not escalate the deficit through a near-zero remaining-days calculation. If the intake floor prevents a planned deficit, this is shown rather than forcing further restriction.

Goal confirmation requires at least three weights within seven days after the first cut week, with the mean at/below goal and a majority of measurements at/below goal. One anomalous low weight cannot end the cut. Once confirmed, the planned deficit becomes zero immediately. Historical goal-confirming evidence survives ordinary rebound; an unsupported old `maintenanceSince` flag cannot declare completion. Changing goal/start settings starts a new confirmation period. No additional profile write races with daily logging.

Calibration holds pre-maintenance evidence during the first four maintenance weeks; later windows exclude the first 14 transition days. There is no mandatory slow reverse-diet ramp. The preliminary [2025 randomized reverse-dieting study](https://pmc.ncbi.nlm.nih.gov/articles/PMC12381988/) did not establish a significant regain advantage for a mandatory ramp.

## Input quality and pace

Dates must be real calendar dates. Profile and log numeric strings are normalized before any arithmetic or display; null and blank values are unknown, not zero. Invalid profiles or incoherent routine/energy assumptions show the existing profile editor with a reason and no invented calorie budget. Invalid optional records stay in storage and are excluded from inference. Pre-cut and future records cannot establish current goal completion, pace or calibration. Before a planned cut starts, today's food and movement still display at estimated maintenance.

Cut IQ's pace verdict and projection use the same recent evidence. They need three weights in each recent seven-day window, at least ten calendar days of observed span, and a cut age of at least fourteen days. The difference between weekly means is normalized by their actual mean observation dates; uneven logging cannot turn an eleven-day change into a seven-day rate. Missing or stale weights do not establish a plateau. A positive rate below the planning ceiling supports an illustrative projection; flat/gaining, excessive rates and unconfirmed goal-level means withhold a completion date. Scenario dates are not statistical confidence intervals.

A loss rate below 75% of the rate implied by the current baseline food allowance is labeled slower than planned, even when positive. This is a product comparison, not a clinical threshold or a separate calorie controller. Heatmap, coach, day-calendar colors and Nutrition adherence share the same 5%/75 kcal calorie window. Progress averages include recorded zeros and exclude missing values. Refeed adherence uses prior calendar days so a partly logged today does not distort that advice.

## Limits and verification

Each weekly review compares the recent weight trend with the original planned rate and checks finished food days against their issued, step-adjusted allowances. It needs at least six matched food and step days in each of the previous two weeks. Two consecutive slow reviews with a usable maintenance estimate can lower the adaptive food target by up to 100 kcal/day. Adjustments are spaced at least 14 days apart, subject to the existing planning floors. Fast loss and recent strength warnings block reductions. Repeated fast loss at the issued allowance can raise the target. A manual target displays the suggested adjustment. Composition estimates and refeed advice remain advisory. A strength dip does not measure muscle loss. Optional refeed advice requires complete food and appropriate intake adherence, and is not a promise of faster loss. Calorie Strategy remains the operative target.

Tests verify accounting, evidence gates, fixed goals, input normalization, date scoping, missing-data holds, outliers, gradual calibration, deadlines, snapshots, maintenance, account isolation and interrupted-save recovery. An idealized energy-balance simulation checks recovery from a deliberately overestimated TDEE and progress beyond a missed deadline. It is a software regression test under specified assumptions, not a clinical trial or biological guarantee. Actual expenditure, logging accuracy, water weight, body composition and completion date cannot be guaranteed by this app.
