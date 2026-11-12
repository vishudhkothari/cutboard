# CUTIQ v2 model and evidence

Research reviewed 12 November 2026. Scientific evidence informs the model; explicit
product heuristics fill the gaps. Tests establish software accounting consistency,
not biological certainty. CUTIQ does not guarantee a body-composition result.

## The invariant

```
estimated expenditure = baseline maintenance + step adjustment
food target           = estimated expenditure - planned deficit
```

An intake minimum can reduce the achievable deficit; the displayed deficit always
equals expenditure minus the final target. It never keeps displaying the original
deficit after raising food to the minimum.

For a supported 2,600 kcal baseline and a 600 kcal deficit, food is 2,000 kcal. If
additional activity truly adds 250 kcal, the equivalent allowance is 2,250 kcal and
the deficit remains 600 kcal. Five thousand extra steps are not universally 250 kcal.
For example, the default level-walking heuristic estimates about 158 kcal at 85 kg
and 180 cm. This is an estimate, not a measured expenditure.

## Initial maintenance and activity

Resting energy uses Mifflin–St Jeor. This predicts resting expenditure, rather than
directly measuring BMR. The initial daily prior is resting energy × 1.2, plus net
walking above 3,000 steps and averaged resistance-training energy. The 1.2 multiplier
and 3,000 incidental steps are implementation assumptions, not a validated equation
for every individual. A known maintenance setting replaces this prior and is anchored
to start weight.

Walking distance uses height × 0.414 per step; net energy uses 0.5 kcal/kg/km. The
stride coefficient is a coarse anthropometric heuristic. The horizontal ACSM walking
oxygen-cost term, converted at approximately 5 kcal/L oxygen, motivates the net
distance cost. Actual walking economy depends on speed, grade and other factors.
Only the difference from usual daily steps changes the allowance, so baseline steps
are not counted again. An open day assumes at least baseline steps; marking the
count final enables a negative adjustment. This prevents a morning's partial count
from immediately reducing the food allowance, while making the assumption visible.

Resistance training uses a 3.5 MET estimate minus the resting component, averaged
over the configured weekly schedule. A training check-in is informational and never
earns another food credit. Repeatedly missing training requires a baseline update.
Walking/cardio sessions are not separately credited, so their steps cannot be paid
twice.

Sources: [original resting-energy equation](https://pubmed.ncbi.nlm.nih.gov/2305711/),
[2024 activity compendium](https://pacompendium.com/adult-compendium/),
[walking-equation validation research](https://pmc.ncbi.nlm.nih.gov/articles/PMC7896743/).

## Pace and limits

At each weekly review, remaining trend-weight loss and remaining calendar days imply
a requested deficit, using 7,700 kcal/kg. This is a short-term approximation, not the
NIH dynamic body-weight model. The baseline is recalculated with current weight and
calibrated as evidence permits. Long-range dates are explicitly approximate.

The prescribed deficit is bounded by all three product rules:

- 0.75% body weight per week.
- 25% of baseline maintenance.
- Food not below 1,500 kcal for males or 1,200 for females.

These are operational guardrails, not proven universal safe thresholds. BMR is not
treated as a minimum allowable intake. The app rejects under-18 profiles and
underweight BMI goals. It is not a clinical nutrition prescription.

Deadlines that exceed these bounds stay visibly infeasible. Passing a deadline
continues the original bounded pace and offers maintenance or a revised date;
remaining time never becomes a near-zero divisor that forces an escalating deficit.
Twelve-week cuts and excessive observed loss prompt a recovery review.

Evidence supports avoiding unnecessarily rapid losses in athletes, but does not
establish one perfect rate for everyone. [Garthe et al.'s original rate-comparison
trial](https://pubmed.ncbi.nlm.nih.gov/21558571/) informs the conservative direction.
[NIH's planner](https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner)
provides the relevant dynamic energy-balance context. CUTIQ does not claim to
implement the full NIH model.

## Learning from observations

Weight display is the mean of available valid weigh-ins within a seven-calendar-day
window. It never invents measurements between entries. Observed weekly loss uses a
raw-weight regression over up to 14 days and requires at least six weigh-ins spanning
ten days. This observed rate is feedback, not a second prescription controller.

Maintenance calibration starts at a weekly review after at least 28 calendar days:

1. Discard the first seven cut days from the calibration window.
2. Use up to 28 calendar days bounded by actual morning weigh-ins, requiring at
   least eight weights spanning 14 days.
3. Require every intake day in the interval to have complete food and final steps.
4. Use intake from the first morning up to, but excluding, the last morning's date.
5. Subtract each day's step adjustment from intake to normalize to baseline activity.
6. Infer baseline maintenance from normalized intake minus weight slope × 7,700.
7. Reject signals outside 65–135% of the formula prior. Otherwise blend conservatively,
   with a maximum deviation of 100 kcal at the first review, increasing 100 kcal per
   review and capped at 20% of the prior. Measured weight is at most 75% of the blend.

The window, completeness requirement, bounds and blend are transparent engineering
choices. They are not a clinically validated estimator. Calibration can be biased by
systematic underlogging, water retention and the energy-density approximation. It
refines a reference expenditure; it cannot independently identify a personalized
step calorie coefficient from these data.

Changing the baseline step count, training schedule, resting-equation inputs or known
maintenance setting restarts this learning window. Historical facts remain stored,
but the previous activity regime cannot immediately recalibrate the new baseline
back to its old expenditure. A new start date begins a separate cut window.

Activity compensation varies. The observational [Careau et al. study](https://pubmed.ncbi.nlm.nih.gov/34453886/)
does not justify applying one fixed compensation percentage to every walk. The app
therefore labels the credit an estimate and checks outcomes over time. [Wearable
validation research](https://pubmed.ncbi.nlm.nih.gov/28538708/) also cautions against
treating device calorie readings as exact measurements.

## Protein and the end of the cut

Protein guides use 2 g/kg during the cut and 1.8 g/kg during maintenance, applied to
the smaller of current weight and 110% of goal weight. The guide is bounded to 40%
of the calorie allowance so macros remain feasible. Fat uses 25% of the allowance;
carbs fill the remaining energy, with small rounding differences. These allocation
rules are practical defaults rather than claims of uniquely optimal macros.

The [Longland controlled trial](https://pubmed.ncbi.nlm.nih.gov/26817506/) supports
higher protein with resistance exercise during restriction, within its young male,
short-duration experimental population. More recent [2026 resistance-trained
participant research](https://pubmed.ncbi.nlm.nih.gov/41940947/) also investigates
high-protein maintenance versus moderate restriction with lifting. Small studies do
not establish a guaranteed individual response or justify extreme restriction.

After the first week, a seven-day weight average with at least three measurements at
or below goal triggers maintenance. The saved phase is latched; ordinary rebound
cannot restart a cut. A user may also start maintenance deliberately. A later cut
requires a new start date or goal in the profile.

Maintenance removes the planned deficit immediately. No mandatory reverse-diet ramp
keeps the user below maintenance. The [2025 randomized preliminary reverse-dieting
study](https://pmc.ncbi.nlm.nih.gov/articles/PMC12381988/) found no statistically
significant group difference in regain; it is limited evidence and does not prove
all approaches equivalent. It does not support requiring a slow ramp for everyone.

The pre-maintenance estimate is held for four maintenance weeks to avoid learning
from the initial water/glycogen rebound. Subsequent calibration excludes the first
14 maintenance days. Continue stable activity, protein and logging. Compare 2–4-week
trends, not a single rebound weigh-in. The app never automatically prescribes a new
cut because a maintenance weigh-in is higher.
