// One daily budget: usual activity, completed extra steps, a bounded deficit,
// and weekly calibration from explicitly complete records.
import {
  buildDayPlan,
  macrosFromCalories,
  estimateTDEE,
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
} from "./modelInputs.js";

export const STEP_KCAL_PER_1000 = 40;
export const ENERGY_DENSITY = 7700;
export const MODEL_VERSION = 5;
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
export const hasSteps = (log) =>
  finite(log?.steps) && +log.steps >= 0 && +log.steps <= 100000;
export const stepCalories = (count) =>
  Math.round(((finite(count) ? +count : 0) * STEP_KCAL_PER_1000) / 1000);
export const completeFood = (log) =>
  log?.foodComplete === true &&
  Array.isArray(log.meals) &&
  log.meals.every((m) => finite(m?.cals) && +m.cals >= 0);

export function movementCredit(setup, log) {
  const final = log?.activityComplete === true;
  const delta = hasSteps(log)
    ? +log.steps - Math.max(0, +setup.stepGoal || 0)
    : 0;
  const stepCredit = stepCalories(final ? delta : Math.max(0, delta));
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
    const values = logs
      .filter(
        (l) =>
          l.date >= shiftDay(review, -6) &&
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
  for (const log of weighed) {
    if (daySpan(startDate, log.date) < 7) continue;
    const values = weighed.filter(
      (w) => w.date <= log.date && w.date >= shiftDay(log.date, -6),
    );
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
      hasSteps(l) &&
      l.activityComplete === true,
  ).length;
  const weighed = records.filter(
    (l) => finite(l.weight) && +l.weight >= 35 && +l.weight <= 350,
  );
  const span =
    weighed.length > 1 ? daySpan(weighed[0].date, weighed.at(-1).date) : 0;
  const ready = daySpan(setup.calibrationSince || start, end) >= 28;
  const estimate = ready
    ? estimateTDEE(records, {
        windowDays: 28,
        fatFraction: (ENERGY_DENSITY - 1800) / (9400 - 1800),
        activityForLog: (l) =>
          hasSteps(l) && l.activityComplete === true
            ? movementCredit(setup, l, end).total
            : NaN,
      })
    : null;
  return {
    estimate,
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
function reviewFor(energy, logs, asOfDate) {
  const weighed = logs.filter((l) => finite(l.weight));
  const recent = weighed.filter((l) => l.date >= shiftDay(asOfDate, -6));
  const previous = weighed.filter(
    (l) => l.date >= shiftDay(asOfDate, -13) && l.date < shiftDay(asOfDate, -6),
  );
  const canMeasure =
    daySpan(energy.profile.startDate, asOfDate) >= 14 &&
    recent.length >= 3 &&
    previous.length >= 3 &&
    daySpan(previous[0].date, recent.at(-1).date) >= 10;
  const mean = (rows) => rows.reduce((s, l) => s + l.weight, 0) / rows.length;
  const meanDay = (rows) => rows.reduce((s,l)=>s+Date.parse(l.date),0)/rows.length/86400000;
  const loss = canMeasure ? (mean(previous)-mean(recent))*7/(meanDay(recent)-meanDay(previous)) : null;
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
      "Complete food and final-step records so maintenance can be reviewed.",
      "Use the current Calorie Strategy allowance; extra steps with their full food credit preserve the same planned deficit.",
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
    const fields=new Set(l.recordReviewFields?.length?l.recordReviewFields:["weight","steps","meals","foodComplete","activityComplete"]);
    return {...l,
      weight:fields.has("weight")?null:l.weight,
      steps:fields.has("steps")?null:l.steps,
      foodComplete:l.foodComplete&&!fields.has("meals")&&!fields.has("foodComplete"),
      activityComplete:l.activityComplete&&!fields.has("steps")&&!fields.has("activityComplete"),
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
  };
  const floor = setup.sex === "female" ? 1200 : 1500;
  const capacity = Math.max(
    0,
    Math.min(
      base * 0.25,
      (curW * ENGINE_CONST.SAFE_RATE * ENERGY_DENSITY) / 7,
      base - floor,
    ),
  );
  const remainingDays = daySpan(reference.date, goalDate);
  const initialRequest =
    (Math.max(0, setup.startWeight - goalWeight) * ENERGY_DENSITY) /
    setup.cutLength;
  const moderateRequest = (curW * ENGINE_CONST.IDEAL_RATE * ENERGY_DENSITY) / 7;
  const requested = deadlineMissed
    ? Math.min(initialRequest, moderateRequest)
    : (Math.max(0, curW - goalWeight) * ENERGY_DENSITY) /
      Math.max(1, remainingDays);
  const plannedDeficit =
    phase === "cut" ? Math.round(Math.min(requested, capacity)) : 0;
  const isManual = setup.manualCalTarget != null && phase === "cut";
  const target = isManual
    ? Math.max(floor, Math.round(setup.manualCalTarget))
    : Math.max(floor, base - plannedDeficit);
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
  const reports = (Array.isArray(cutIntel?.strengthReports) ? cutIntel.strengthReports : []).filter(
    (r) =>
      validDate(r.recordedAt) &&
      ["up", "same", "slight_down", "down"].includes(r.signal) &&
      r.recordedAt >= startDate &&
      r.recordedAt <= asOfDate,
  );
  const risk = evaluateMuscleRisk({
    strengthReports: reports,
    e1rmTrend: objectiveE1rmTrend(workoutHistory, asOfDate),
  });
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
    finite(snapshot?.eatTarget)
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
export function createPlanSnapshot(args) {
  const { source = "captured" } = args;
  const plan = getPlanForDate({ ...args, ignoreSnapshot: true });
  const tdee = plan.energy;
  if (!tdee.valid) throw new Error(tdee.inputIssues.join(" "));
  return {
    modelVersion: MODEL_VERSION,
    target: tdee.target,
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
