// One daily budget: usual activity, completed extra steps, a bounded deficit,
// and weekly calibration from explicitly complete records.
import {
  buildDayPlan,
  macrosFromCalories,
  currentTrendWeight,
  estimateTDEE,
  inferBodyComp,
  normalizeStepTarget,
  leannessRateMultiplier,
  ENGINE_CONST,
} from "./cutEngine.js";

export const STEP_KCAL_PER_1000 = 40;
export const ENERGY_DENSITY = 7700;
export const MODEL_VERSION = 4;
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

export function movementCredit(setup, log, asOfDate = today()) {
  const final =
    log?.activityComplete === true ||
    (log?.activityComplete !== false && log?.date < asOfDate);
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
  const bf =
    finite(setup.startBF) && +setup.startBF > 0 && +setup.startBF < 65
      ? +setup.startBF
      : null;
  return bf == null
    ? 10 * weight +
        6.25 * height -
        5 * age +
        (setup.sex === "female" ? -161 : 5)
    : 370 + 21.6 * weight * (1 - bf / 100);
}
const trendAt = (setup, logs, date) =>
  currentTrendWeight(logs.filter((l) => l.date <= date)) ??
  (+setup.startWeight || 70);
function goalFor(setup, logs, cutIntel, asOfDate) {
  if (finite(setup.goalWeight) && +setup.goalWeight > 0)
    return +setup.goalWeight;
  const candidate = cutIntel?.anchor;
  const anchor =
    candidate && candidate.date >= setup.startDate && candidate.date <= asOfDate
      ? candidate
      : {
          date: setup.startDate,
          weight: +setup.startWeight,
          bf: setup.startBF,
        };
  if (
    !finite(anchor.bf) ||
    +anchor.bf <= 0 ||
    !finite(setup.goalBF) ||
    +setup.goalBF <= 0 ||
    +setup.goalBF >= 65
  )
    return null;
  const comp = inferBodyComp({
    logs,
    anchor,
    strengthSignal: null,
    startDate: setup.startDate,
  });
  return (
    (comp?.leanMass ?? anchor.weight * (1 - anchor.bf / 100)) /
    (1 - setup.goalBF / 100)
  );
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

export function getAdaptiveTDEE(
  setup,
  logs,
  asOfDate = today(),
  cutIntel = null,
) {
  if (!setup)
    return {
      target: 1800,
      base: 2400,
      bmr: 1600,
      floor: 1500,
      curW: 70,
      deficit: 600,
      effMaint: 2400,
      activityCredit: 0,
      stepCredit: 0,
      phase: "cut",
      calibration: { status: "learning", completeDays: 0, weighIns: 0 },
      isDataDriven: false,
    };
  const startDate = setup.startDate || asOfDate;
  const scoped = [
    ...new Map(
      logs
        .filter((l) => l?.date && l.date >= startDate && l.date <= asOfDate)
        .map((l) => [l.date, l]),
    ).values(),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const elapsed = Math.max(0, daySpan(startDate, asOfDate));
  const reviewDate = shiftDay(startDate, Math.floor(elapsed / 7) * 7);
  const history = scoped.filter((l) => l.date <= reviewDate);
  const curW = trendAt(setup, history, reviewDate);
  const bmr = Math.round(restingEnergy(setup, curW));
  const multiplier = multipliers[setup.activity] || 1.45;
  const formulaTDEE = Math.round(bmr * multiplier);
  const goalWeight = goalFor(setup, history, cutIntel, reviewDate);
  const reachedDate = goalReachedDate(scoped, goalWeight, startDate);
  const latched =
    setup.maintenanceSince && setup.maintenanceSince <= asOfDate
      ? setup.maintenanceSince
      : null;
  const maintenanceSince = latched || reachedDate;
  const phase = maintenanceSince ? "maintenance" : "cut";
  const cutLength = Math.max(1, +setup.cutLength || 60);
  const deadlineMissed = phase === "cut" && elapsed >= cutLength;

  // Replay accepted weekly reviews. A missing recent log holds the learned
  // baseline instead of suddenly reverting it to the original formula.
  let learnedBase = null,
    priorFormula = null,
    estimate = null,
    lastReview = null,
    fingerprint = null;
  for (let day = 28; day <= Math.floor(elapsed / 7) * 7; day += 7) {
    const date = shiftDay(startDate, day);
    if (daySpan(setup.calibrationSince || startDate, date) < 28) continue;
    const weight = trendAt(setup, scoped, date);
    const formula = Math.round(
      Math.round(restingEnergy(setup, weight)) * multiplier,
    );
    if (learnedBase != null) learnedBase += formula - priorFormula;
    priorFormula = formula;
    const input = calibrationInput(setup, scoped, date, maintenanceSince);
    const candidate = input.estimate;
    if (
      !candidate ||
      candidate.tdee < formula * 0.65 ||
      candidate.tdee > formula * 1.5
    )
      continue;
    const nextFingerprint = `${candidate.firstDate}:${candidate.lastDate}:${candidate.tdee}:${candidate.avgIntake}`;
    if (nextFingerprint === fingerprint) continue;
    const current = learnedBase ?? formula;
    learnedBase = current + clamp((candidate.tdee - current) * 0.5, -100, 100);
    estimate = candidate;
    lastReview = date;
    fingerprint = nextFingerprint;
  }
  const base = Math.round(learnedBase ?? formulaTDEE);
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
        : lastReview !== reviewDate && asOfDate !== reviewDate
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
  const compAnchor =
    cutIntel?.anchor?.date >= startDate && cutIntel.anchor.date <= reviewDate
      ? cutIntel.anchor
      : { date: startDate, weight: +setup.startWeight, bf: setup.startBF };
  const comp = inferBodyComp({
    logs: history,
    anchor: compAnchor,
    strengthSignal: null,
    startDate,
  });
  const rateMultiplier = leannessRateMultiplier(
    comp?.bf ?? setup.startBF,
    setup.goalBF,
  );
  const capacity = Math.max(
    0,
    Math.min(
      base * 0.25,
      (curW * ENGINE_CONST.SAFE_RATE * rateMultiplier * ENERGY_DENSITY) / 7,
      base - floor,
    ),
  );
  const remainingDays = cutLength - Math.max(0, daySpan(startDate, reviewDate));
  const requested =
    remainingDays > 0 && goalWeight != null
      ? (Math.max(0, curW - goalWeight) * ENERGY_DENSITY) / remainingDays
      : (curW * ENGINE_CONST.IDEAL_RATE * rateMultiplier * ENERGY_DENSITY) / 7;
  const plannedDeficit =
    phase === "maintenance" ? 0 : Math.round(Math.min(requested, capacity));
  const isManual = finite(setup.manualCalTarget) && +setup.manualCalTarget > 0;
  const target =
    isManual && phase === "cut"
      ? Math.max(floor, Math.round(+setup.manualCalTarget))
      : Math.max(floor, base - plannedDeficit);
  const log = scoped.find((l) => l.date === asOfDate);
  const movement = movementCredit(setup, log, today());
  const dailyTarget = Math.max(floor, target + movement.total);
  return {
    modelVersion: MODEL_VERSION,
    target,
    base,
    bmr,
    floor,
    curW,
    adj: movement.total,
    deficit: base + movement.total - dailyTarget,
    effMaint: base + movement.total,
    activityCredit: movement.total,
    stepCredit: movement.stepCredit,
    isManual,
    isDataDriven: learnedBase != null,
    estimate,
    calibration,
    phase,
    reachedDate,
    maintenanceSince,
    phaseReason: maintenanceSince ? "goal" : null,
    reviewDate,
    goalWeight,
    requestedDeficit: Math.round(requested),
    goalTooAggressive:
      phase === "cut" && (deadlineMissed || requested > capacity + 1),
    deadlineMissed,
    stepKcalPer1000: STEP_KCAL_PER_1000,
  };
}

export function getPlanForDate({
  date,
  log,
  setup,
  logs,
  cutIntel = null,
  ignoreSnapshot = false,
}) {
  const scoped = [
    ...logs.filter((l) => l.date !== date),
    ...(log ? [{ ...log, date }] : []),
  ];
  const tdee = getAdaptiveTDEE(setup, scoped, date, cutIntel);
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
    };
  }
  return { ...plan, modelVersion: MODEL_VERSION };
}
export function createPlanSnapshot(args) {
  const { date, log, setup, logs, cutIntel = null, source = "captured" } = args;
  const scoped = [
    ...logs.filter((l) => l.date !== date),
    ...(log ? [{ ...log, date }] : []),
  ];
  const tdee = getAdaptiveTDEE(setup, scoped, date, cutIntel);
  const plan = getPlanForDate({ ...args, ignoreSnapshot: true });
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

export function getDynamicStepGoal(
  setup,
  logs,
  prescribedSteps = null,
  currentLog = null,
  cutIntel = null,
) {
  const baseline = normalizeStepTarget(setup?.stepGoal, 10000);
  const normalGoal = normalizeStepTarget(prescribedSteps ?? baseline, baseline);
  const dated = logs
    .filter((l) => hasSteps(l) && l.date >= (setup?.startDate || ""))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 14);
  const average = dated.length
    ? dated.reduce((s, l) => s + +l.steps, 0) / dated.length
    : baseline;
  const ceiling = Math.max(
    normalGoal,
    Math.min(setup?.userMaxStepBudget || 14000, average + 4000),
  );
  const asOf = currentLog?.date || today();
  const entries = [
    ...logs.filter((l) => l.date < asOf && l.date >= (setup?.startDate || "")),
    ...(currentLog ? [currentLog] : []),
  ].sort((a, b) => a.date.localeCompare(b.date));
  let debt = 0;
  for (const log of entries) {
    if (!log.meals?.length && !completeFood(log)) continue;
    // Unknown historical prescriptions cannot establish a calorie debt. Use
    // captured allowances; only today's live budget needs recalculation.
    const snapshot = log.planSnapshot;
    const allowance =
      log.date === asOf
        ? getPlanForDate({
            date: log.date,
            log,
            setup,
            logs,
            cutIntel,
            ignoreSnapshot: true,
          }).eatTarget
        : snapshot?.source !== "reconstructed" && finite(snapshot?.eatTarget)
          ? +snapshot.eatTarget
          : null;
    if (allowance == null) continue;
    const calories = (log.meals || []).reduce((s, m) => s + (+m.cals || 0), 0);
    const difference = calories - allowance;
    debt = Math.max(
      0,
      debt + (completeFood(log) ? difference : Math.max(0, difference)),
    );
  }
  if (debt < 1)
    return { goal: normalGoal, extra: 0, reason: null, outstandingKcal: 0 };
  const completed = hasSteps(currentLog) ? +currentLog.steps : 0;
  const required =
    Math.max(baseline, completed) +
    Math.ceil(debt / (STEP_KCAL_PER_1000 / 1000));
  const goal = normalizeStepTarget(
    Math.min(ceiling, Math.max(normalGoal, required)),
    normalGoal,
  );
  return {
    goal,
    extra: Math.max(0, goal - baseline),
    outstandingKcal: Math.round(debt),
    capped: required > ceiling,
    reason: `${Math.round(debt)} kcal above logged allowances. Optional movement stays within your limit; eating its full credit keeps the same planned deficit.`,
  };
}
