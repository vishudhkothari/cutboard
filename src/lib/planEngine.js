// One daily budget: logged activity, a bounded deficit, and weekly calibration
// from saved food, steps and morning weigh-ins. No daily sign-off is needed.
import {
  buildDayPlan,
  macrosFromCalories,
  analyzeTDEE,
  inferBodyComp,
  ENGINE_CONST,
  evaluateMuscleRisk,
  objectiveE1rmTrend,
} from "./cutEngine.js";

import {
  normalizeProfile,
  normalizeLogs,
  weightEvidence,
  numeric,
  median,
  validDate,
  completeFood,
  hasSteps,
  reviewFields,
  withinCalorieTarget,
} from "./modelInputs.js";

export { completeFood, hasSteps } from "./modelInputs.js";

export const STEP_KCAL_PER_1000 = 40;
export const ENERGY_DENSITY = 7700;
export const MODEL_VERSION = 7;
const finite = (x) =>
  (typeof x === "number" || (typeof x === "string" && x.trim() !== "")) &&
  Number.isFinite(+x);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const multipliers = {
  sed: 1.15,
  light: 1.3,
  mod: 1.45,
  active: 1.6,
  extra: 1.75,
};
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const daySpan = (a, b) =>
  Math.round(
    (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000,
  );
export const shiftDay = (s, n) =>
  new Date(Date.parse(`${s}T12:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
export const stepCalories = (count) =>
  Math.round(((finite(count) ? +count : 0) * STEP_KCAL_PER_1000) / 1000);

export function movementCredit(setup, log) {
  const final = hasSteps(log);
  const delta = final
    ? +log.steps - Math.max(0, +setup.stepGoal || 0)
    : 0;
  const stepCredit = stepCalories(delta);
  return { stepCredit, total: stepCredit, final };
}

export function restingEnergy(setup, weightKg) {
  const weight = finite(weightKg) && +weightKg > 0 ? +weightKg : 70;
  const height =
    finite(setup.height) && +setup.height > 0 ? +setup.height : 175;
  const age = finite(setup.age) && +setup.age > 0 ? +setup.age : 25;
  // Use one adult RMR prior. A visual/scale body-fat estimate must not choose
  // a different energy equation or imply that starting BF is current BF.
  return 10 * weight +
        6.25 * height -
        5 * age +
        (setup.sex === "female" ? -161 : 5);
}
function referenceAt(setup, logs, date) {
  for (
    let review = date;
    review >= setup.startDate;
    review = shiftDay(review, -7)
  ) {
    const from = shiftDay(review, -6);
    const values = logs
      .filter(
        (l) =>
          l.date >= from &&
          l.date <= review &&
          finite(l.weight),
      )
      .map((l) => l.weight);
    if (values.length >= 3) return { date: review, weight: median(values) };
  }
  return { date: setup.startDate, weight: setup.startWeight };
}
function goalReachedDate(logs, goalWeight, startDate) {
  if (!finite(goalWeight)) return null;
  const weighed = logs.filter(
    (l) => finite(l.weight) && +l.weight >= 35 && +l.weight <= 350,
  );
  let first = 0;
  for (const [index, log] of weighed.entries()) {
    if (daySpan(startDate, log.date) < 7) continue;
    const from = shiftDay(log.date, -6);
    while (weighed[first].date < from) first++;
    const values = weighed.slice(first, index + 1);
    if (
      values.length >= 3 &&
      values.filter((w) => +w.weight <= goalWeight).length >
        values.length / 2 &&
      values.reduce((s, w) => s + +w.weight, 0) / values.length <= goalWeight
    )
      return log.date;
  }
  return null;
}

function calibrationInput(setup, logs, reviewDate, maintenanceSince) {
  const start = setup.startDate || reviewDate;
  maintenanceSince =
    maintenanceSince && maintenanceSince <= reviewDate
      ? maintenanceSince
      : null;
  const hold = maintenanceSince && reviewDate < shiftDay(maintenanceSince, 28);
  const end = hold ? shiftDay(maintenanceSince, -1) : reviewDate;
  const first = [
    shiftDay(start, 7),
    setup.calibrationSince || start,
    ...(maintenanceSince && !hold ? [shiftDay(maintenanceSince, 14)] : []),
  ]
    .sort()
    .at(-1);
  const windowStart = [first, shiftDay(end, -27)].sort().at(-1);
  const records = logs.filter((l) => l.date >= windowStart && l.date <= end);
  const completeDays = records.filter(
    (l) =>
      l.date < end &&
      completeFood(l) &&
      hasSteps(l),
  ).length;
  const weighed = records.filter(
    (l) => finite(l.weight) && +l.weight >= 35 && +l.weight <= 350,
  );
  const span =
    weighed.length > 1 ? daySpan(weighed[0].date, weighed.at(-1).date) : 0;
  const ready = daySpan(setup.calibrationSince || start, end) >= 28;
  const analysis = ready
    ? analyzeTDEE(records, {
        windowDays: 28,
        asOfDate: end,
        fatFraction: (ENERGY_DENSITY - 1800) / (9400 - 1800),
        activityForLog: (l) =>
          hasSteps(l)
            ? movementCredit(setup, l).total
            : NaN,
      })
    : {estimate:null, reason:"Weekly learning begins after four weeks of saved food, steps and morning weights."};
  return {
    estimate: analysis.estimate,
    reason: analysis.reason,
    missingFoodDates: analysis.missingFoodDates || [],
    missingStepsDates: analysis.missingStepsDates || [],
    completeDays,
    weighIns: weighed.length,
    spanDays: span,
    ready,
    hold: !!hold,
  };
}

const roundRate = (value) => Math.round(value * 100) / 100;
function invalidEnergy(profile, inputIssues) {
  return {
    valid:false, profile, inputIssues, records:[], target:null, base:null,
    bmr:null, floor:null, curW:null, deficit:null, effMaint:null,
    activityCredit:0, stepCredit:0, phase:"review_profile", isDataDriven:false,
    calibration:{status:"review_profile",completeDays:0,weighIns:0},
  };
}
function weeklyLoss(logs, asOfDate, start) {
  const from = shiftDay(asOfDate, -13), middle = shiftDay(asOfDate, -6);
  const weighed = logs.filter(l => l.date >= from && l.date >= start && l.date <= asOfDate && finite(l.weight));
  const recent = weighed.filter((l) => l.date >= middle);
  const previous = weighed.filter(
    (l) => l.date < middle,
  );
  const canMeasure =
    daySpan(start, asOfDate) >= 14 &&
    recent.length >= 3 &&
    previous.length >= 3 &&
    daySpan(recent.at(-1).date, asOfDate) <= 3 &&
    daySpan(previous[0].date, recent.at(-1).date) >= 10;
  const mean = (rows) => rows.reduce((s, l) => s + l.weight, 0) / rows.length;
  const meanDay = (rows) => rows.reduce((s,l)=>s+Date.parse(l.date),0)/rows.length/86400000;
  return canMeasure ? (mean(previous)-mean(recent))*7/(meanDay(recent)-meanDay(previous)) : null;
}

const deficitCapacity = (base, weight, floor) => Math.max(0,
  Math.min(base * .25, weight * ENGINE_CONST.SAFE_RATE * ENERGY_DENSITY / 7, base - floor));

function strengthAt(reports, workouts, logs, date) {
  return evaluateMuscleRisk({
    strengthReports:reports.filter(r => r.recordedAt >= shiftDay(date, -13) && r.recordedAt <= date),
    e1rmTrend:objectiveE1rmTrend(workouts, date, logs),
  });
}

// Judge finished food days against what was issued for each date. Legacy
// records use the baseline in effect that week, plus that day's movement.
function foodEvidence(logs, date, setup, floor, baselineOn) {
  const middle = shiftDay(date, -7), first = shiftDay(date, -14);
  const counts = [0, 0], matchedSteps = [0, 0];
  let calories = 0, allowance = 0;
  for (const l of logs) {
    if (l.date < first || l.date >= date || !completeFood(l)) continue;
    const snapshot = l.planSnapshot;
    const issued = snapshot?.source !== "reconstructed" ? numeric(snapshot?.eatTarget) : null;
    const target = issued ?? Math.max(floor, baselineOn(l.date) + movementCredit(setup, l).total);
    if (target <= 0) continue;
    const week = l.date < middle ? 0 : 1;
    counts[week]++;
    if (hasSteps(l)) matchedSteps[week]++;
    calories += l.meals.reduce((sum, meal) => sum + Number(meal.cals), 0);
    allowance += target;
  }
  const days = counts[0] + counts[1];
  return { ready:matchedSteps.every(count => count >= 6), days,
    intake:days ? Math.round(calories / days) : null, allowance:days ? Math.round(allowance / days) : null };
}

function decideFood({ date, target, lastChange, base, floor, capacity, weight, plannedRate, loss, priorLoss, food, risk, calibrated, manual }) {
  const fast = weight * ENGINE_CONST.SAFE_RATE * 1.1;
  const onBudget = food.ready && withinCalorieTarget(food.intake, food.allowance);
  const cooldown = lastChange && daySpan(lastChange, date) < 14;
  let change = 0, reason;
  if (loss > fast && onBudget && (priorLoss > fast || risk.confirmed) && !cooldown) {
    change = Math.max(0, Math.min(100, base - target));
    reason = change ? "Loss is repeatedly fast or accompanied by declining strength. Increase the baseline allowance." : "Loss is fast at the estimated maintenance allowance. Review the trend and recovery.";
  } else if (loss > fast || risk.confirmed || risk.watch) {
    reason = food.ready && !onBudget && food.intake < food.allowance
      ? "Recovery review. Bring intake back to the issued allowance before considering a change."
      : "Hold the allowance and review the recent weight and strength trend.";
  } else if (loss == null || !food.ready) {
    reason = "Hold the allowance while more morning weights, food and steps are recorded.";
  } else if (!onBudget) {
    reason = `Hold the allowance. Logged intake averaged ${food.intake} kcal against an issued ${food.allowance} kcal.`;
  } else if (loss >= plannedRate * .75) {
    reason = "Weight is falling at the planned pace. Keep the allowance.";
  } else if (!calibrated || priorLoss == null || priorLoss >= plannedRate * .75) {
    reason = "Hold the allowance until two weekly reviews show slow progress and maintenance can be estimated.";
  } else if (cooldown) {
    reason = "Hold the allowance for 14 days after the last adjustment.";
  } else {
    change = -100;
    reason = "Two reviews show slow progress at the issued allowance. Reduce the baseline by one step.";
  }
  const suggested = Math.max(floor, Math.round(base - capacity), target + change);
  if (suggested > target + change) reason = "The planning limit sets the minimum suggested baseline allowance.";
  const next = manual ? target : suggested;
  return { date, previousTarget:target, target:next, suggestedTarget:suggested, reason, food,
    lastChange:next !== target ? date : lastChange };
}

function weeklyFoodPlan({ setup, logs, asOfDate, reviewDate, floor, formulaFor, calibrationHistory, reports, workouts }) {
  const start = [setup.startDate, setup.goalChangedAt, setup.calibrationSince, setup.foodPlanSince]
    .filter(d => validDate(d) && d <= asOfDate).sort().at(-1) || setup.startDate;
  const startWeight = start === setup.startDate ? setup.startWeight : referenceAt(setup, logs, start).weight;
  const goalDate = shiftDay(setup.startDate, setup.cutLength);
  const remaining = daySpan(start, goalDate);
  const request = remaining > 0 ? Math.max(0, startWeight - setup.goalWeight) * ENERGY_DENSITY / remaining
    : startWeight * ENGINE_CONST.IDEAL_RATE * ENERGY_DENSITY / 7;
  const startingBase = formulaFor(start);
  const initialDeficit = Math.min(request, deficitCapacity(startingBase, startWeight, floor));
  const manual = setup.manualCalTarget != null;
  const initial = Math.max(floor, Math.round(manual ? setup.manualCalTarget : startingBase - initialDeficit));
  let decision = { date:start, target:initial, previousTarget:initial, suggestedTarget:initial, lastChange:null,
    reason:"Starting allowance at usual steps. The next weekly review checks progress." };
  const baselines = new Map([[start, initial]]);
  const baselineOn = date => {
    const week = shiftDay(setup.startDate, Math.floor(daySpan(setup.startDate, date) / 7) * 7);
    return baselines.get(week) ?? initial;
  };
  // Include both ends of each logged week. Empty stretches do not produce
  // a sequence of changes, and the last issued allowance carries forward.
  const dates = new Set([reviewDate]);
  const captures = new Map();
  for (const l of logs) {
    if (l.date < start) continue;
    const week = shiftDay(setup.startDate, Math.floor(daySpan(setup.startDate, l.date) / 7) * 7);
    dates.add(week);
    dates.add(shiftDay(week, 7));
    const s = l.planSnapshot;
    if (!manual && l.date < asOfDate && s && s.source !== "reconstructed" && s.phase === "cut" &&
        !s.isManual && numeric(s.target) > 0) {
      captures.set(week, { log:l, snapshot:s });
    }
  }
  let correction = 0;
  for (const [d, value] of calibrationHistory) if (d < start) correction = value;
  for (const date of [...dates].filter(d => d <= reviewDate).sort()) {
    if (calibrationHistory.has(date)) correction = calibrationHistory.get(date);
    if (date < start && shiftDay(date, 7) <= start) continue;
    if (date > start) {
      const weight = referenceAt(setup, logs, date).weight;
      const base = Math.round(formulaFor(date) + correction);
      const capacity = deficitCapacity(base, weight, floor);
      decision = decideFood({ date, target:decision.target, lastChange:decision.lastChange, base, floor, capacity, weight,
        plannedRate:Math.min(request, capacity) * 7 / ENERGY_DENSITY,
        loss:weeklyLoss(logs, date, start), priorLoss:weeklyLoss(logs, shiftDay(date, -7), start),
        food:foodEvidence(logs, date, setup, floor, baselineOn), risk:strengthAt(reports, workouts, logs, date),
        calibrated:calibrationHistory.has(date), manual });
    }
    const captured = captures.get(date);
    if (captured) {
      const s = captured.snapshot;
      const oldSteps = numeric(s.usualSteps) ?? (hasSteps(captured.log) && finite(s.stepCredit)
        ? captured.log.steps - s.stepCredit * 1000 / STEP_KCAL_PER_1000 : setup.stepGoal);
      const shift = stepCalories(setup.stepGoal - oldSteps);
      const savedTarget = Math.max(floor, Math.round(Number(s.target) + shift));
      const saved = Number(s.modelVersion) === MODEL_VERSION && s.foodReview?.date === decision.date &&
        finite(s.foodReview.previousTarget) && finite(s.foodReview.suggestedTarget) ? s.foodReview : null;
      decision = saved ? { ...saved, previousTarget:Number(saved.previousTarget) + shift, target:savedTarget,
        suggestedTarget:Number(saved.suggestedTarget) + shift } : { ...decision, target:savedTarget, previousTarget:savedTarget,
        suggestedTarget:savedTarget, lastChange:captured.log.date, reason:"Using the baseline previously issued for this week." };
    }
    baselines.set(date, decision.target);
  }
  return decision;
}

function reviewFor(energy, logs, asOfDate) {
  const loss = weeklyLoss(logs, asOfDate, energy.profile.startDate);
  const canMeasure = loss != null;
  const gap = Math.max(0, energy.currentWeight - energy.goalWeight);
  const daysLeft = Math.max(0, daySpan(asOfDate, energy.goalDate));
  const plannedRate =
    (Math.max(0, energy.base - energy.target) * 7) / ENERGY_DENSITY;
  const stats = {
    requiredRateKg: daysLeft ? roundRate((gap * 7) / daysLeft) : null,
    requiredPct: daysLeft
      ? roundRate(((gap * 7) / daysLeft / energy.curW) * 100)
      : null,
    actualRateKg: loss == null ? null : roundRate(loss),
    safeRateKg: roundRate(energy.curW * ENGINE_CONST.SAFE_RATE),
    idealRateKg: roundRate(plannedRate),
    goalWeight: energy.goalWeight,
    kgToGo: roundRate(gap),
    goalTooAggressive: energy.goalTooAggressive,
    recommendedSteps: energy.stepGoal,
    cardioRx: null,
  };
  let status, headline, actions;
  if (energy.phase === "maintenance") {
    status = "reached";
    headline = "Maintenance mode";
    actions = [
      "The planned deficit is zero. Continue recording weight, food and movement while the estimate settles.",
    ];
  } else if (energy.phase === "planned") {
    status = "learning";
    headline = "Cut has not started yet";
    actions = [
      `The cut starts on ${energy.profile.startDate}. The current allowance is estimated maintenance.`,
    ];
  } else if (!canMeasure) {
    status = "learning";
    headline = "Not enough recent weigh-ins to judge pace";
    actions = [
      "Record at least three weights in each recent seven-day window, spanning at least ten calendar days.",
      "Missing or old weights do not establish a current plateau.",
    ];
  } else if (energy.deficit <= 0) {
    status = "calorie_hold";
    headline = "This allowance has no planned deficit";
    actions = [
      "Review the fixed calorie override or profile in Calorie Strategy.",
    ];
  } else if (loss < -0.1) {
    status = "gaining";
    headline = `Recent weight trend is rising ${roundRate(-loss)} kg/week`;
    actions = [
      "Check complete food records and the next calorie review.",
      "Do not add a second calorie cut or punishment step target on top of the displayed budget.",
    ];
  } else if (loss > energy.curW * ENGINE_CONST.SAFE_RATE * 1.1) {
    status = "too_fast";
    headline = "Recent loss is above the planning ceiling";
    actions = [
      "Review food allowance and recovery before another reduction.",
      "The rate includes scale-weight changes, including water; it is not a measurement of fat loss.",
    ];
  } else if (loss < 0.1) {
    status = "too_slow";
    headline = "Recent weight trend is flat";
    actions = [
      "Keep logging food, steps and morning weights so maintenance can be reviewed.",
      "Use the current Calorie Strategy allowance; extra steps with their full food credit preserve the same planned deficit.",
    ];
  } else if (loss < plannedRate * .75) {
    status = "too_slow";
    headline = `Losing more slowly than planned: ${roundRate(loss)} kg/week`;
    actions = [
      "The trend is falling, but is below the rate implied by the current allowance.",
      "Keep logging. The next calorie review uses actual intake, steps and weight changes to adjust estimated maintenance.",
      "Use the displayed allowance while it learns; do not stack another reduction on top.",
    ];
  } else {
    status = "on_track";
    headline = `Recent loss: ${roundRate(loss)} kg/week`;
    actions = [
      "Continue the displayed calorie allowance and complete daily records.",
      energy.deadlineMissed
        ? "The original deadline passed; the cut continues within its limits."
        : "Review the trend over several weeks rather than one weigh-in.",
    ];
  }
  let projection;
  if (energy.phase === "maintenance") projection = { reached: true };
  else if (canMeasure && gap <= 0) projection = {early:true,reason:"The recent mean is at the goal. Repeated goal-level readings are still needed to confirm maintenance."};
  else if (!canMeasure) projection = { early: true, reason: actions[0] };
  else if (loss < 0.1)
    projection = { stalled: true, meanRateKg: roundRate(-loss) };
  else if (loss > energy.curW * ENGINE_CONST.SAFE_RATE * 1.1)
    projection = {
      early: true,
      reason:
        "The recent rate exceeds the planning ceiling. Review it before projecting a goal date.",
    };
  else {
    const weeks = gap / loss;
    projection = {
      goalWeight: energy.goalWeight,
      kgToGo: roundRate(gap),
      weeksMid: Math.round(weeks * 10) / 10,
      meanRateKg: roundRate(-loss),
      dateMid: shiftDay(asOfDate, Math.ceil(weeks * 7)),
      dateFast: shiftDay(asOfDate, Math.ceil((weeks / 1.25) * 7)),
      dateSlow: shiftDay(asOfDate, Math.ceil((weeks / 0.75) * 7)),
    };
  }
  if (energy.foodReview) {
    const decision = energy.foodReview;
    actions = [decision.reason, `Next food review on ${energy.calibration.nextReviewDate}.`];
  }
  return {
    review: { ...stats, status, headline, actions, learning: !canMeasure },
    projection,
    observedWeeklyLoss: loss,
  };
}

export function getAdaptiveTDEE(
  rawSetup,
  rawLogs,
  asOfDate = today(),
  cutIntel = null,
  workoutHistory = [],
) {
  const checked = normalizeProfile(rawSetup);
  if (!validDate(asOfDate))
    checked.errors.push("The requested date is invalid.");
  if (checked.errors.length)
    return invalidEnergy(checked.value, checked.errors);
  const setup = checked.value;
  if (setup.goalChangedAt > asOfDate) setup.goalChangedAt = null;
  if (setup.calibrationSince > asOfDate) setup.calibrationSince = null;
  const normalized = normalizeLogs(rawLogs, {
    startDate: asOfDate < setup.startDate ? asOfDate : setup.startDate,
    endDate: asOfDate,
  });
  const undisputed = normalized.value.map(l => {
    if(!l.recordNeedsReview)return l;
    const fields=new Set(reviewFields(l));
    return {...l,
      weight:fields.has("weight")?null:l.weight,
      steps:fields.has("steps")?null:l.steps,
      sleep:fields.has("sleep")?null:l.sleep,
    };
  });
  const evidence = weightEvidence(undisputed);
  const outliers = new Set(evidence.outliers);
  const scoped = undisputed.map((l) =>
    outliers.has(l.date) ? { ...l, weight: null } : l,
  );
  const startDate = setup.startDate;
  const elapsed = Math.max(0, daySpan(startDate, asOfDate));
  const reviewDate = shiftDay(startDate, Math.floor(elapsed / 7) * 7);
  const reference = referenceAt(setup, scoped, reviewDate);
  const curW = reference.weight;
  const bmr = Math.round(restingEnergy(setup, curW));
  const multiplier = multipliers[setup.activity];
  const baselineMovement = stepCalories(setup.stepGoal - setup.activityReferenceSteps);
  const formulaFor = (date) =>
    Math.round(
      Math.round(
        restingEnergy(setup, referenceAt(setup, scoped, date).weight),
      ) * multiplier + baselineMovement,
    );
  const formulaTDEE = Math.round(bmr * multiplier + baselineMovement);
  const goalWeight = setup.goalWeight;
  const epoch =
    setup.goalChangedAt && setup.goalChangedAt > startDate
      ? setup.goalChangedAt
      : startDate;
  const reachedDate = goalReachedDate(
    scoped.filter((l) => l.date >= epoch),
    goalWeight,
    startDate,
  );
  // Confirmation remains discoverable in historical weigh-ins after a water
  // rebound. An unverified legacy flag cannot end an unfinished cut.
  const maintenanceSince = reachedDate;
  const phase =
    asOfDate < startDate ? "planned" : maintenanceSince ? "maintenance" : "cut";
  const goalDate = shiftDay(startDate, setup.cutLength);
  const deadlineMissed = phase === "cut" && asOfDate >= goalDate;
  // Only weeks with actual recent weighing can add evidence. Long gaps cannot
  // replay thousands of empty reviews or repeatedly apply one old window.
  const reviewDates = [
    ...new Set(
      evidence.accepted
        .map((l) => {
          const offset = Math.ceil(daySpan(startDate, l.date) / 7) * 7;
          const date = shiftDay(startDate, offset);
          return offset >= 28 &&
            date <= reviewDate &&
            daySpan(l.date, date) <= 3
            ? date
            : null;
        })
        .filter(Boolean),
    ),
  ].sort();
  let correction = null,
    estimate = null,
    lastReview = null,
    fingerprint = null;
  const calibrationHistory = new Map();
  for (const date of reviewDates) {
    if (daySpan(setup.calibrationSince || startDate, date) < 28) continue;
    const formula = formulaFor(date);
    const candidate = calibrationInput(
      setup,
      scoped,
      date,
      maintenanceSince,
    ).estimate;
    if (
      !candidate ||
      candidate.tdee < formula * 0.65 ||
      candidate.tdee > formula * 1.5
    )
      continue;
    const nextFingerprint = `${candidate.firstDate}:${candidate.lastDate}:${candidate.tdee}:${candidate.avgIntake}`;
    if (nextFingerprint === fingerprint) continue;
    const current = formula + (correction ?? 0);
    correction =
      (correction ?? 0) + clamp((candidate.tdee - current) * 0.5, -100, 100);
    estimate = candidate;
    lastReview = date;
    fingerprint = nextFingerprint;
    calibrationHistory.set(date, correction);
  }
  const base = Math.round(formulaTDEE + (correction ?? 0));
  if (!Number.isFinite(base) || base <= stepCalories(setup.stepGoal))
    return invalidEnergy(setup,["The usual-step and activity assumptions cannot support a coherent energy estimate. Review the usual steps and activity level in this profile."]);
  const input = calibrationInput(setup, scoped, asOfDate, maintenanceSince);
  const plausible =
    input.estimate &&
    input.estimate.tdee >= formulaTDEE * 0.65 &&
    input.estimate.tdee <= formulaTDEE * 1.5;
  const status = input.hold
    ? "transition_hold"
    : !input.ready
      ? "learning"
      : !plausible
        ? "needs_data"
        : lastReview !== reviewDate
          ? "waiting_review"
          : "calibrated";
  const calibration = {
    status,
    completeDays: input.completeDays,
    weighIns: input.weighIns,
    spanDays: input.spanDays,
    lastAcceptedReview: lastReview,
    nextReviewDate: shiftDay(reviewDate, 7),
    reason: input.hold
      ? "Holding calibration while maintenance water weight settles."
      : input.estimate && !plausible
        ? "The observed maintenance estimate is outside the formula's review range. Check food, steps and profile assumptions."
        : input.reason,
    missingFoodDates: input.missingFoodDates,
    missingStepsDates: input.missingStepsDates,
  };
  const floor = setup.sex === "female" ? 1200 : 1500;
  const capacity = deficitCapacity(base, curW, floor);
  const remainingDays = daySpan(reference.date, goalDate);
  const initialRequest =
    (Math.max(0, setup.startWeight - goalWeight) * ENERGY_DENSITY) /
    setup.cutLength;
  const moderateRequest = (curW * ENGINE_CONST.IDEAL_RATE * ENERGY_DENSITY) / 7;
  const requested = deadlineMissed
    ? Math.min(initialRequest, moderateRequest)
    : (Math.max(0, curW - goalWeight) * ENERGY_DENSITY) /
      Math.max(1, remainingDays);
  const isManual = setup.manualCalTarget != null && phase === "cut";
  const reports = (Array.isArray(cutIntel?.strengthReports) ? cutIntel.strengthReports : []).filter(r =>
    validDate(r?.recordedAt) && ["up", "same", "slight_down", "down"].includes(r.signal) &&
    r.recordedAt >= startDate && r.recordedAt <= asOfDate);
  const workouts = (Array.isArray(workoutHistory) ? workoutHistory : []).filter(w => validDate(w?.date) && w.date >= startDate && w.date <= asOfDate);
  let foodReview = phase === "cut" ? weeklyFoodPlan({ setup, logs:scoped, asOfDate, reviewDate, floor,
    formulaFor, calibrationHistory, reports, workouts }) : null;
  const minimum = Math.max(floor, Math.round(base - capacity));
  if (foodReview && !isManual && foodReview.target < minimum) {
    foodReview = { ...foodReview, previousTarget:foodReview.target, target:minimum, suggestedTarget:minimum,
      lastChange:reviewDate, reason:"The planning limit raises the previously issued baseline allowance." };
  }
  const target = foodReview?.target ?? Math.max(floor, base);
  const log = scoped.find((l) => l.date === asOfDate);
  const movement = movementCredit(setup, log);
  const dailyTarget = Math.max(floor, target + movement.total);
  const stepPlan = getDynamicStepGoal(setup, scoped, cutIntel?.stepGoal);
  const stepGoal = stepPlan.goal;
  const energy = {
    valid: true,
    modelVersion: MODEL_VERSION,
    profile: setup,
    records: scoped,
    inputIssues: [...normalized.errors, ...normalized.value.filter(l => l.recordNeedsReview)
      .map(l => `${l.date}: saved versions disagree; review and confirm this day in Today.`)],
    excludedWeights: evidence.outliers,
    target,
    base,
    bmr,
    floor,
    curW,
    latestWeight: evidence.accepted.at(-1)?.weight ?? setup.startWeight,
    currentWeight: (()=>{const values=evidence.accepted.filter(l=>l.date>=shiftDay(asOfDate,-6)).map(l=>l.weight);return values.length>=3?values.reduce((s,x)=>s+x,0)/values.length:evidence.accepted.at(-1)?.weight??setup.startWeight})(),
    adj: movement.total,
    deficit: base + movement.total - dailyTarget,
    effMaint: base + movement.total,
    activityCredit: movement.total,
    stepCredit: movement.stepCredit,
    stepGoal,
    stepPlan,
    isManual,
    isDataDriven: correction != null,
    estimate,
    calibration,
    foodReview,
    manualExceedsLimit:isManual && base - target > capacity + 1,
    phase,
    reachedDate,
    maintenanceSince,
    phaseReason: reachedDate ? "goal" : phase === "planned" ? "start_pending" : null,
    reviewDate,
    referenceDate: reference.date,
    goalDate,
    goalWeight,
    requestedDeficit: Math.round(requested),
    goalTooAggressive:
      phase === "cut" && (deadlineMissed || requested > capacity + 1),
    deadlineMissed,
    stepKcalPer1000: STEP_KCAL_PER_1000,
    dayCount: asOfDate < startDate ? 0 : elapsed + 1,
    daysLeft: Math.max(0, daySpan(asOfDate, goalDate)),
  };
  const anchor =
    cutIntel?.anchor &&
    validDate(cutIntel.anchor.date) &&
    numeric(cutIntel.anchor.weight) >= 35 && numeric(cutIntel.anchor.weight) <= 350 &&
    numeric(cutIntel.anchor.bf) >= 3 && numeric(cutIntel.anchor.bf) <= 65 &&
    cutIntel.anchor.date >= startDate &&
    cutIntel.anchor.date <= asOfDate
      ? {
          ...cutIntel.anchor,
          weight: numeric(cutIntel.anchor.weight),
          bf: numeric(cutIntel.anchor.bf),
        }
      : { date: startDate, weight: setup.startWeight, bf: setup.startBF };
  const risk = strengthAt(reports, workouts, scoped, asOfDate);
  const signal = [...reports].sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt)).at(-1)?.signal??null;
  energy.bodyComp = inferBodyComp({
    logs: scoped,
    anchor,
    strengthSignal: signal === "down" && !risk.confirmed ? null : signal,
    startDate,
  });
  energy.currentBF = energy.bodyComp?.bf ?? anchor.bf;
  energy.anchor=anchor;
  energy.strengthSignal=reports.filter(r=>Number(r.weekKey)===Math.floor(elapsed/7)).at(-1)?.signal??null;
  energy.muscleRisk = risk;
  return { ...energy, ...reviewFor(energy, scoped, asOfDate) };
}

export function getPlanForDate({
  date,
  log,
  setup,
  logs,
  cutIntel = null,
  ignoreSnapshot = false,
  workoutHistory = [],
}) {
  log ??= Array.isArray(logs) ? logs.find(l => l.date === date) : null;
  const scoped = [
    ...(Array.isArray(logs) ? logs : []).filter((l) => l.date !== date),
    ...(log ? [{ ...log, date }] : []),
  ];
  const tdee = getAdaptiveTDEE(setup, scoped, date, cutIntel, workoutHistory);
  if (!tdee.valid)
    return {
      eatTarget: null,
      maintenance: null,
      deficit: null,
      energy: tdee,
      modelVersion: MODEL_VERSION,
    };
  const plan = buildDayPlan({
    baseTarget: tdee.target,
    maintenance: tdee.effMaint,
    floor: tdee.floor,
    activityCredit: tdee.activityCredit,
    currentWeightKg: tdee.curW,
    proteinFactor: cutIntel?.proteinFactor,
  });
  const snapshot = log?.planSnapshot;
  if (
    !ignoreSnapshot &&
    date < today() &&
    snapshot?.source !== "reconstructed" &&
    finite(snapshot?.eatTarget) && +snapshot.eatTarget >= 0
  ) {
    const maintenance = finite(snapshot.effMaint)
      ? +snapshot.effMaint
      : plan.maintenance;
    return {
      ...plan,
      ...macrosFromCalories(+snapshot.eatTarget, null, tdee.curW, {
        factor: cutIntel?.proteinFactor,
      }),
      eatTarget: +snapshot.eatTarget,
      maintenance,
      deficit: Math.round(maintenance - snapshot.eatTarget),
      activityNeutralTarget:
        snapshot.activityNeutralTarget ?? snapshot.eatTarget,
      activityCredit: snapshot.activityCredit ?? 0,
      historical: true,
      energy: {
        ...tdee,
        stepGoal: numeric(snapshot.stepGoal) ?? tdee.stepGoal,
        base: finite(snapshot.base) ? +snapshot.base : tdee.base,
        effMaint: maintenance,
        deficit: Math.round(maintenance - snapshot.eatTarget),
        target: finite(snapshot.target)
          ? +snapshot.target
          : +snapshot.eatTarget,
        stepCredit: finite(snapshot.stepCredit) ? +snapshot.stepCredit : 0,
        phase: snapshot.phase || tdee.phase,
      },
    };
  }
  return { ...plan, energy: tdee, modelVersion: MODEL_VERSION };
}

export function createTargetResolver({ setup, logs = [], cutIntel, workoutHistory, asOfDate = today(), currentPlan }) {
  const byDate = new Map(logs.map(l => [l.date, l]));
  const cache = new Map(), weekly = new Map();
  const usualGoal = getDynamicStepGoal(setup, [], cutIntel?.stepGoal).goal;
  const { value:profile, errors } = normalizeProfile(setup);
  let history;
  function reconstructed(date, log) {
    if (date === asOfDate && currentPlan) return currentPlan.eatTarget;
    if (errors.length) return null;
    history ??= normalizeLogs(logs, { startDate:profile.startDate, endDate:asOfDate }).value;
    const week = shiftDay(profile.startDate, Math.floor(daySpan(profile.startDate, date) / 7) * 7);
    const rows = history.filter(l => l.date <= date);
    const weights = weightEvidence(rows.filter(l => !reviewFields(l).includes('weight')));
    const epoch = profile.goalChangedAt && profile.goalChangedAt <= date ? profile.goalChangedAt : profile.startDate;
    const since = goalReachedDate(weights.accepted.filter(l => l.date >= epoch), profile.goalWeight, profile.startDate);
    const lastIssued = rows.findLast(l => l.date >= week && l.date < date && l.planSnapshot?.phase === 'cut' &&
      l.planSnapshot.source !== 'reconstructed' && !l.planSnapshot.isManual && numeric(l.planSnapshot.target) > 0);
    // Weekly food and expenditure can change inside a week only at a phase
    // or profile transition, a captured decision, or an outlier reclassification.
    const key = [week, since, epoch, profile.calibrationSince <= date && profile.calibrationSince,
      profile.foodPlanSince <= date && profile.foodPlanSince, lastIssued?.date, ...weights.outliers].join('|');
    if (!weekly.has(key)) {
      const energy = getAdaptiveTDEE(setup, logs, date, cutIntel, workoutHistory);
      weekly.set(key, energy.valid ? { target:energy.target, floor:energy.floor } : null);
    }
    const state = weekly.get(key);
    return state ? Math.max(state.floor, state.target + movementCredit(profile, log).total) : null;
  }
  return date => {
    if (cache.has(date)) return cache.get(date);
    const log = byDate.get(date);
    const captured = date < asOfDate && log?.planSnapshot?.source !== "reconstructed" ? log?.planSnapshot : null;
    const saved = numeric(captured?.eatTarget), steps = numeric(captured?.stepGoal);
    const targets = { calories:saved != null && saved >= 0 ? saved : reconstructed(date, log),
      steps:steps != null && steps >= 0 && steps <= 100000 ? steps : usualGoal,
      estimated:date < asOfDate && (saved == null || saved < 0 || steps == null || steps < 0 || steps > 100000) };
    cache.set(date, targets);
    return targets;
  };
}

export function createPlanSnapshot(args) {
  const { source = "captured" } = args;
  const plan = getPlanForDate({ ...args, ignoreSnapshot: true });
  const tdee = plan.energy;
  if (!tdee.valid) throw new Error(tdee.inputIssues.join(" "));
  return {
    modelVersion: MODEL_VERSION,
    target: tdee.target,
    isManual: tdee.isManual,
    usualSteps: tdee.profile.stepGoal,
    foodReview: tdee.foodReview,
    base: tdee.base,
    bmr: tdee.bmr,
    floor: tdee.floor,
    effMaint: plan.maintenance,
    activityCredit: tdee.activityCredit,
    activityNeutralTarget: plan.activityNeutralTarget,
    stepCredit: tdee.stepCredit,
    phase: tdee.phase,
    eatTarget: plan.eatTarget,
    deficit: plan.deficit,
    stepGoal: tdee.stepGoal,
    source,
  };
}

// A fitness preference is not a calorie-debt collector. Historical fasting,
// meals and snapshots cannot raise a person's movement prescription.
export function getDynamicStepGoal(setup, _logs = [], prescribedSteps = null) {
  const baseline = clamp(numeric(setup?.stepGoal) ?? 10000, 0, 100000);
  const ceiling = Math.max(
    baseline,
    Math.min(numeric(setup?.userMaxStepBudget) ?? 14000, baseline + 4000),
  );
  const requested = numeric(prescribedSteps) ?? baseline;
  const goal = clamp(Math.round(requested),Math.ceil(baseline),Math.floor(ceiling));
  return {
    goal,
    extra: Math.max(0, goal - baseline),
    reason:
      goal !== requested
        ? "The saved fitness goal exceeds the configured movement range; the displayed goal is capped."
        : null,
    outstandingKcal: 0,
    capped: goal !== requested,
  };
}
