# CUTIQ model and evidence

Reviewed 12 November 2026. The original features remain active. This document describes the shared model behind them. Product heuristics are explicit; software consistency does not establish physiological certainty.

## Energy accounting

```
estimated expenditure = baseline maintenance + completed movement credit
food allowance        = baseline cut allowance + completed movement credit
planned net deficit   = estimated expenditure - final food allowance
```

The chosen step coefficient is **40 kcal per 1,000 extra steps**, independent of body weight. Only the difference from the configured usual step count earns credit. Thus 10,000 baseline steps and a 2,000 kcal allowance become 2,200 kcal at 15,000 steps. With baseline expenditure of 2,600, that is 2,800 minus 2,200: the same 600 kcal planned deficit. It is a conservative product choice, not a measurement or universal physiological coefficient.

A live partial step count below baseline does not immediately debit food. An explicitly finalized count, or a recorded historical day, can have a negative adjustment. Missing steps are unknown. The intake floor takes precedence; the displayed deficit uses the final allowance when a floor prevents full compensation. Captured past prescriptions remain a record of what was shown then.

Incline walking uses a net heuristic of `0.08 * weightKg * completedMinutes`. Configured minutes alone earn nothing. Up to 90 steps/minute of the completed walk are assumed to overlap steps above baseline; their step credit is deducted from the incline credit. Speed, gradient and whether a device counted the walk are unknown, so this is deliberately an estimate. Zone 2 sessions remain a training/adherence feature; they do not create a second unmeasured calorie credit.

Walking cost varies with mass, speed, gradient and economy. The [2024 Compendium](https://pacompendium.com/walking/) and [walking-energy model research](https://pubmed.ncbi.nlm.nih.gov/26679617/) describe that variability. [Careau et al.](https://pubmed.ncbi.nlm.nih.gov/34453886/) does not justify one universal compensation discount for every individual activity.

## Baseline and pace

The familiar activity levels remain: resting energy multiplied by 1.15/1.3/1.45/1.6/1.75. This baseline includes the usual routine, baseline steps and gym; logging a workout does not pay for it again. Resting energy uses the original lean-mass equation when a valid body-fat anchor exists, otherwise [Mifflin-St Jeor](https://pubmed.ncbi.nlm.nih.gov/2305711/). Neither equation directly measures expenditure.

At weekly reviews, remaining scale-weight loss and calendar time imply a requested deficit using 7,700 kcal/kg. A scale goal takes precedence when configured; otherwise the original modeled body-fat goal derives an estimated goal weight. The 7,700 approximation is not a full dynamic body-weight model. See [NIDDK's planner](https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner) for the dynamic context.

Automatic deficits are bounded by 25% of baseline expenditure, 0.75% body weight/week with the original leanness taper, and the food floor (1,500 male / 1,200 female). These are product limits, not universal clinical safety thresholds. An infeasible deadline is flagged. The original manual food target remains an explicit baseline override, subject to the food floor; completed extra movement still adjusts it.

Protein retains the original dynamic default of 2 g/kg with 110-220 g bounds. Macros are allocated from the final allowance, so extra calories flow through the same macro helper. [Longland et al.](https://pubmed.ncbi.nlm.nih.gov/26817506/) supports higher protein with resistance exercise during restriction in its studied population; it does not establish a guaranteed individual outcome.

## Optional schedules and coaching

Steady and zigzag remain available. Zigzag redistributes the neutral weekly target with an exact integer weekly total, including floor clipping. Earned movement is added after that distribution. Optional full fasting or 25% compensation deliberately changes the allowance and deficit; it is an exception to an otherwise steady cutting plan. Logged meals survive all fasting toggles, and actual intake is never replaced by a fasting prescription.

Pace, strength, composition and refeed features remain advisory. Initial pace/projection judgments wait for about two calendar weeks of weights. Strength changes can indicate fatigue or recovery issues; they do not measure muscle loss. Composition fractions and projected dates are model assumptions. Movement advice explicitly states that eating the full movement credit preserves the same deficit, so a higher step goal cannot promise faster loss at that allowance. Refeeds may support adherence/training; they are not promised hormone resets or fat-loss accelerators.

## Calibration

Calibration is reviewed weekly, no earlier than day 28. It excludes the first seven cut days and uses up to 28 days of records with at least eight weights spanning 14 days. Morning weights bound the interval: intake includes the first morning's date and excludes the last morning's date.

Every intake day in that interval must be present. Explicitly incomplete food, missing meals, missing step counts and nonfast daily totals below 1,000 block calibration. Original logs do not contain whole-day confirmations; plausible meal totals are a compatibility assumption, not proof of completeness. Actual explicit fasting can be zero, and any meals on a fasting day are included. Missing days are never invented as zero intake.

Baseline TDEE is inferred from actual average intake minus completed movement credit minus the weight-regression slope times 7,700. The observed estimate is blended conservatively with the formula, with measured weight at most 75% and total correction bounded to 20% of the prior. Changing baseline profile inputs restarts the learning window. This cannot distinguish underlogging from lower expenditure, or identify an individual's true step coefficient. Consistent weighing, food logging and activity remain necessary.

## Maintenance

A seven-day window containing at least three weights averaging at/below the scale goal can confirm goal attainment after the first cut week. Maintenance also starts when the configured cut window ends, preserving that scheduling feature; the interface distinguishes window expiry from goal confirmation. An attained goal is retained through ordinary weight rebound. A later cut requires changing the goal/start settings.

Maintenance immediately removes the planned deficit. There is no mandatory slow calorie ramp. The preliminary [2025 randomized reverse-dieting study](https://pmc.ncbi.nlm.nih.gov/articles/PMC12381988/) did not find a significant group difference in regain; its limited results do not establish equivalence or support requiring a slow ramp for everybody.

Calibration holds the pre-maintenance learning window through the first four maintenance weeks. Later windows exclude the first 14 maintenance days to reduce water/glycogen contamination. Continue stable activity, protein, lifting and logging; assess several weeks of trend instead of one rebound weight. Optional fasting/zigzag remain user choices and their actual plan is displayed explicitly.
