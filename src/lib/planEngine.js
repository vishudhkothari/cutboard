// One budget resolver behind the original interface. Activity settings describe
// the baseline; only completed movement above it earns additional food.
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
export const inclineWalkBurn = (minutes, weightKg) =>
  Math.round(Math.max(0, +minutes || 0) * Math.max(0, +weightKg || 0) * 0.08);

export function movementCredit(setup, log, weightKg, asOfDate = today()) {
  const baselineSteps = Math.max(0, +setup.stepGoal || 0);
  const final =
    log?.activityComplete === true || (log?.date && log.date < asOfDate);
  const delta = hasSteps(log) ? +log.steps - baselineSteps : 0;
  const stepCredit = stepCalories(final ? delta : Math.max(0, delta));
  const minutes = finite(log?.inclineMin) ? clamp(+log.inclineMin, 0, 600) : 0;
  const cardioBurn = inclineWalkBurn(minutes, weightKg);
  // Incline walking steps are normally inside the device's step total. Credit
  // its extra intensity once, rather than paying for the same steps twice.
  const overlapSteps = Math.min(Math.max(0, delta), minutes * 90);
  const cardioCredit = Math.max(0, cardioBurn - stepCalories(overlapSteps));
  return {
    stepCredit,
    cardioCredit,
    cardioBurn,
    overlapSteps,
    total: stepCredit + cardioCredit,
    final,
  };
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

function goalFor(setup, logs, cutIntel, asOfDate) {
  if (finite(setup.goalWeight) && +setup.goalWeight > 0)
    return +setup.goalWeight;
  const candidate = cutIntel?.anchor;
  const anchor =
    candidate && candidate.date <= asOfDate
      ? candidate
      : {
          date: setup.startDate,
          weight: +setup.startWeight,
          bf: +setup.startBF,
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
  const lean = comp?.leanMass ?? anchor.weight * (1 - anchor.bf / 100);
  return lean / (1 - setup.goalBF / 100);
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
      values.reduce((s, w) => s + +w.weight, 0) / values.length <= goalWeight
    )
      return log.date;
  }
  return null;
}

export function getAdaptiveTDEE(
  setup,
  logs,
  _planSettings = {},
  asOfDate = today(),
  cutIntel = null,
) {
  if (!setup)
    return {
      target: 1800,
      base: 2400,
      adj: 0,
      curW: 70,
      deficit: 600,
      isDataDriven: false,
      bmr: 1600,
      floor: 1500,
      phase: "cut",
      activeCut: false,
      cardioBurn: 0,
      cardioMin: 0,
      foodDeficit: 600,
      effMaint: 2400,
      activityCredit: 0,
      stepCredit: 0,
      cardioCredit: 0,
    };
  const startDate = setup.startDate || asOfDate;
  const scoped = [
    ...new Map(
      logs
        .filter((l) => l?.date && l.date <= asOfDate && l.date >= startDate)
        .map((l) => [l.date, l]),
    ).values(),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const elapsed = Math.max(0, daySpan(startDate, asOfDate));
  const reviewDate = shiftDay(startDate, Math.floor(elapsed / 7) * 7);
  const history = scoped.filter((l) => l.date <= reviewDate);
  const curW =
    currentTrendWeight(history) ??
    (finite(setup.startWeight) && +setup.startWeight > 0
      ? +setup.startWeight
      : 70);
  const bmr = Math.round(restingEnergy(setup, curW));
  const formulaTDEE = Math.round(bmr * (multipliers[setup.activity] || 1.45));
  const goalWeight = goalFor(setup, history, cutIntel, reviewDate);
  const reachedDate = goalReachedDate(scoped, goalWeight, startDate);
  const cutLength = Math.max(1, +setup.cutLength || 60);
  const latchedMaintenance =
    setup.maintenanceSince && setup.maintenanceSince <= asOfDate;
  const phase =
    reachedDate || latchedMaintenance || elapsed >= cutLength
      ? "maintenance"
      : "cut";
  const maintenanceSince =
    (latchedMaintenance ? setup.maintenanceSince : null) ||
    reachedDate ||
    (elapsed >= cutLength ? shiftDay(startDate, cutLength) : null);
  const estimationEnd =
    maintenanceSince && reviewDate < shiftDay(maintenanceSince, 28)
      ? shiftDay(maintenanceSince, -1)
      : reviewDate;
  const learningStart = [
    shiftDay(startDate, 7),
    setup.calibrationSince || startDate,
    ...(maintenanceSince && reviewDate >= shiftDay(maintenanceSince, 28)
      ? [shiftDay(maintenanceSince, 14)]
      : []),
  ]
    .sort()
    .at(-1);
  const learningLogs = history.filter(
    (l) => l.date >= learningStart && l.date <= estimationEnd,
  );
  // Old meal logs do not prove perfect completeness. Require a continuous
  // plausible intake window, delay calibration, and bound the update.
  const estimate =
    daySpan(setup.calibrationSince || startDate, estimationEnd) >= 28
      ? estimateTDEE(learningLogs, {
          windowDays: 28,
          fatFraction: (ENERGY_DENSITY - 1800) / (9400 - 1800),
          activityForLog: (l) =>
            hasSteps(l) ? movementCredit(setup, l, curW, asOfDate).total : NaN,
        })
      : null;
  const measuredWeight = estimate ? Math.min(0.75, estimate.spanDays / 42) : 0;
  const correction = estimate
    ? clamp(
        (estimate.tdee - formulaTDEE) * measuredWeight,
        -formulaTDEE * 0.2,
        formulaTDEE * 0.2,
      )
    : 0;
  const base = Math.round(formulaTDEE + correction);
  const floor = setup.sex === "female" ? 1200 : 1500;
  const remainingDays = Math.max(
    1,
    cutLength - Math.max(0, daySpan(startDate, reviewDate)),
  );
  const requested =
    goalWeight != null
      ? (Math.max(0, curW - goalWeight) * ENERGY_DENSITY) / remainingDays
      : 600;
  const compAnchor =
    cutIntel?.anchor?.date <= reviewDate
      ? cutIntel.anchor
      : { date: startDate, weight: +setup.startWeight, bf: setup.startBF };
  const composition = inferBodyComp({
    logs: history,
    anchor: compAnchor,
    strengthSignal: null,
    startDate,
  });
  const rateMultiplier = leannessRateMultiplier(
    composition?.bf ?? setup.startBF,
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
  const plannedDeficit =
    phase === "maintenance" ? 0 : Math.round(Math.min(requested, capacity));
  const isManual = finite(setup.manualCalTarget) && +setup.manualCalTarget > 0;
  const target =
    isManual && phase !== "maintenance"
      ? Math.max(floor, Math.round(+setup.manualCalTarget))
      : Math.max(floor, base - plannedDeficit);
  const log = scoped.find((l) => l.date === asOfDate);
  const movement = movementCredit(setup, log, curW, today());
  const activeOverride = setup.activeCutDays?.[asOfDate];
  const activeCut =
    activeOverride == null ? !!setup.activeCut : !!activeOverride;
  const dailyTarget = Math.max(floor, target + movement.total);
  return {
    target,
    base,
    bmr,
    floor,
    curW,
    adj: movement.total,
    deficit: base + movement.total - dailyTarget,
    foodDeficit: base - dailyTarget,
    effMaint: base + movement.total,
    activityCredit: movement.total,
    stepCredit: movement.stepCredit,
    cardioCredit: movement.cardioCredit,
    cardioBurn: movement.cardioBurn,
    cardioGoalBurn: inclineWalkBurn(+setup.cardioMin || 35, curW),
    cardioMin: activeCut ? +setup.cardioMin || 35 : 0,
    activeCut,
    isManual,
    isDataDriven: !!estimate,
    estimate,
    phase,
    reachedDate,
    maintenanceSince,
    phaseReason: reachedDate
      ? "goal"
      : latchedMaintenance
        ? "goal"
        : phase === "maintenance"
          ? "deadline"
          : null,
    weeksOver: Math.max(0, Math.ceil((elapsed - cutLength + 1) / 7)),
    reviewDate,
    goalWeight,
    requestedDeficit: Math.round(requested),
    goalTooAggressive: phase === "cut" && requested > capacity + 1,
    stepKcalPer1000: STEP_KCAL_PER_1000,
  };
}

export function getPlanForDate({
  date,
  log,
  setup,
  logs,
  planSettings = {},
  zigzagSettings = {},
  cutIntel = null,
  ignoreSnapshot = false,
}) {
  const scoped = [
    ...logs.filter((l) => l.date !== date),
    ...(log ? [{ ...log, date }] : []),
  ];
  const tdee = getAdaptiveTDEE(setup, scoped, planSettings, date, cutIntel);
  const plan = buildDayPlan({
    baseTarget: tdee.target,
    maintenance: tdee.effMaint,
    floor: tdee.floor,
    activityCredit: tdee.activityCredit,
    regime: zigzagSettings.on ? "zigzag" : "steady",
    zigzag: {
      schedule: zigzagSettings.schedule || 1,
      mode: zigzagSettings.mode || "weight",
    },
    fastingDays: planSettings.fastingDays || [],
    fastComp: !!planSettings.fastCompensation,
    manualFastToday: !!log?.fasting,
    overriddenToday: !!log?.fastingOverridden,
    currentWeightKg: tdee.curW,
    proteinFactor: cutIntel?.proteinFactor,
    dateObj: new Date(date + "T12:00:00"),
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
    };
  }
  return { ...plan, modelVersion: 3 };
}

export function createPlanSnapshot(args) {
  const {
    date,
    log,
    setup,
    logs,
    planSettings = {},
    cutIntel = null,
    source = "captured",
  } = args;
  const scoped = [
    ...logs.filter((l) => l.date !== date),
    ...(log ? [{ ...log, date }] : []),
  ];
  const tdee = getAdaptiveTDEE(setup, scoped, planSettings, date, cutIntel);
  const plan = getPlanForDate({ ...args, ignoreSnapshot: true });
  return {
    modelVersion: 3,
    target: tdee.target,
    base: tdee.base,
    bmr: tdee.bmr,
    floor: tdee.floor,
    effMaint: plan.maintenance,
    activityCredit: tdee.activityCredit,
    activityNeutralTarget: plan.activityNeutralTarget,
    stepCredit: tdee.stepCredit,
    cardioCredit: tdee.cardioCredit,
    activeCut: tdee.activeCut,
    cardioBurn: tdee.cardioBurn,
    cardioMin: tdee.cardioMin,
    phase: tdee.phase,
    eatTarget: plan.eatTarget,
    deficit: plan.deficit,
    source,
  };
}

export function getDynamicStepGoal(
  setup,
  logs,
  tdeeData,
  planSettings = {},
  zigzagSettings = {},
  prescribedSteps = null,
  currentLog = null,
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
  let debt = 0;
  const entries = [
    ...logs.filter((l) => l.date < asOf && l.date >= (setup?.startDate || "")),
    ...(currentLog ? [currentLog] : []),
  ].sort((a, b) => a.date.localeCompare(b.date));
  for (const log of entries) {
    if (log.foodComplete === false || (!log.meals?.length && !log.fasting))
      continue;
    const normalLog = {
      ...log,
      fasting: false,
      fastingOverridden: true,
      planSnapshot: null,
    };
    const plan = getPlanForDate({
      date: log.date,
      log: normalLog,
      setup,
      logs,
      planSettings,
      zigzagSettings,
      ignoreSnapshot: true,
    });
    // Credit only the additional deficit versus the normal cut allowance.
    // An empty, unlogged day never clears earlier compensation.
    const calories = (log.meals || []).reduce((s, m) => s + (+m.cals || 0), 0);
    const difference = calories - plan.eatTarget;
    debt = Math.max(
      0,
      debt +
        (log.date === asOf && log.foodComplete !== true && !log.fasting
          ? Math.max(0, difference)
          : difference),
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
  const capped = required > ceiling;
  return {
    goal,
    extra: Math.max(0, goal - baseline),
    outstandingKcal: Math.round(debt),
    capped,
    reason: `${Math.round(debt)} kcal above the allowance${capped ? "; movement limit reached — review intake rather than chasing more steps" : ` · ${STEP_KCAL_PER_1000} kcal per 1,000 extra steps`}`,
  };
}
