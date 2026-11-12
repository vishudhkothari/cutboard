// All energy, pace and phase decisions live here. No UI or storage.
export const POLICY = Object.freeze({
  density: 7700,
  maxWeeklyFraction: 0.0075,
  maxDeficitFraction: 0.25,
  learningDays: 28,
});
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const number = (x) =>
  (typeof x === "number" || (typeof x === "string" && x.trim() !== "")) &&
  Number.isFinite(Number(x));
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s;
}
export const daysBetween = (a, b) =>
  Math.round(
    (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000,
  );
export function addDays(s, n) {
  return new Date(Date.parse(`${s}T12:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function validateProfile(p) {
  const errors = [];
  for (const [key, lo, hi, label] of [
    ["age", 18, 100, "Age"],
    ["height", 120, 230, "Height"],
    ["startWeight", 40, 300, "Start weight"],
    ["goalWeight", 40, 300, "Goal weight"],
    ["baselineSteps", 0, 30000, "Baseline steps"],
    ["gymDays", 0, 7, "Training days"],
    ["gymMinutes", 0, 180, "Training minutes"],
  ])
    if (!number(p[key]) || +p[key] < lo || +p[key] > hi)
      errors.push(`${label} must be between ${lo} and ${hi}.`);
  for (const key of ["age", "gymDays", "baselineSteps"])
    if (number(p[key]) && !Number.isInteger(+p[key]))
      errors.push(
        `${key === "gymDays" ? "Training days" : key === "baselineSteps" ? "Baseline steps" : "Age"} must be a whole number.`,
      );
  if (!["male", "female"].includes(p.sex))
    errors.push("Choose a sex for the resting-energy equation.");
  if (+p.goalWeight >= +p.startWeight)
    errors.push("Goal weight must be below start weight.");
  if (+p.goalWeight / (+p.height / 100) ** 2 < 18.5)
    errors.push("This app does not prescribe a cut to an underweight goal.");
  if (
    !validDate(p.startDate) ||
    !validDate(p.goalDate) ||
    p.goalDate <= p.startDate
  )
    errors.push("Goal date must follow a valid start date.");
  if (
    p.maintenanceOverride !== "" &&
    p.maintenanceOverride != null &&
    (!number(p.maintenanceOverride) ||
      +p.maintenanceOverride < 1200 ||
      +p.maintenanceOverride > 6000)
  )
    errors.push("Known baseline maintenance must be 1200–6000 kcal, or blank.");
  return errors;
}
export function cleanLogs(logs, asOf) {
  return [
    ...new Map(
      logs
        .filter((l) => validDate(l.date) && l.date <= asOf)
        .map((l) => [l.date, l]),
    ).values(),
  ].sort((a, b) => a.date.localeCompare(b.date));
}
export function intake(log) {
  return (log?.meals || []).reduce(
    (s, m) => s + (number(m.cals) && +m.cals >= 0 ? +m.cals : 0),
    0,
  );
}
export function weightTrend(logs, asOf) {
  const weighed = cleanLogs(logs, asOf).filter(
    (l) => number(l.weight) && +l.weight >= 35 && +l.weight <= 350,
  );
  return weighed.map((l) => {
    const window = weighed.filter(
      (w) => w.date <= l.date && w.date >= addDays(l.date, -6),
    );
    return {
      date: l.date,
      raw: +l.weight,
      trend: mean(window.map((w) => +w.weight)),
      samples: window.length,
    };
  });
}
export function restingEnergy(profile, weight) {
  return (
    10 * weight +
    6.25 * +profile.height -
    5 * +profile.age +
    (profile.sex === "male" ? 5 : -161)
  );
}
// Net level walking: 0.5 kcal/kg/km × stride estimated from height. Initial heuristic.
export const stepEnergy = (profile, weight) =>
  0.5 * weight * ((+profile.height * 0.414) / 100000);
export function formulaMaintenance(profile, weight) {
  if (number(profile.maintenanceOverride) && +profile.maintenanceOverride > 0) {
    return (
      +profile.maintenanceOverride +
      10 * (weight - +profile.startWeight) +
      (stepEnergy(profile, weight) -
        stepEnergy(profile, +profile.startWeight)) *
        Math.max(0, +profile.baselineSteps - 3000)
    );
  }
  // Sedentary prior already includes incidental activity (~3000 steps).
  const walking =
    Math.max(0, +profile.baselineSteps - 3000) * stepEnergy(profile, weight);
  // 3.5 MET lifting minus resting expenditure, averaged over the week.
  const training =
    (2.5 * weight * (+profile.gymMinutes / 60) * +profile.gymDays) / 7;
  return restingEnergy(profile, weight) * 1.2 + walking + training;
}
export function activityAdjustment(profile, log, weight) {
  if (
    !number(log?.steps) ||
    !Number.isInteger(+log.steps) ||
    +log.steps < 0 ||
    +log.steps > 100000
  )
    return 0;
  const delta = +log.steps - +profile.baselineSteps;
  return (
    (log.activityComplete ? delta : Math.max(0, delta)) *
    stepEnergy(profile, weight)
  );
}
function slope(points) {
  const x = points.map((p) => daysBetween(points[0].date, p.date)),
    y = points.map((p) => +p.weight);
  const mx = mean(x),
    my = mean(y);
  return (
    x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) /
    x.reduce((s, v) => s + (v - mx) ** 2, 0)
  );
}
export function calibrate(profile, logs, reviewDate, weight, prior) {
  const learningStart =
    validDate(profile.calibrationSince) &&
    profile.calibrationSince > profile.startDate
      ? profile.calibrationSince
      : profile.startDate;
  const learning = {
    maintenance: prior,
    source: "formula",
    days: 0,
    reason:
      learningStart === profile.startDate
        ? "Collect complete food and step logs; calibration starts after four weeks."
        : `Baseline settings changed on ${learningStart}. Calibration needs four weeks under the new baseline.`,
  };
  if (daysBetween(learningStart, reviewDate) < POLICY.learningDays)
    return learning;
  if (
    validDate(profile.maintenanceSince) &&
    profile.maintenanceSince <= reviewDate &&
    daysBetween(profile.maintenanceSince, reviewDate) < 28
  ) {
    const held = calibrate(
      { ...profile, maintenanceSince: null },
      logs.filter((l) => l.date < profile.maintenanceSince),
      addDays(profile.maintenanceSince, -1),
      weight,
      prior,
    );
    return {
      ...held,
      reason:
        "Holding the pre-maintenance estimate while water and glycogen settle. Fresh calibration resumes after four maintenance weeks.",
    };
  }
  const start = [
    addDays(reviewDate, -28),
    addDays(profile.startDate, 7),
    learningStart,
    ...(validDate(profile.maintenanceSince) &&
    profile.maintenanceSince <= reviewDate
      ? [addDays(profile.maintenanceSince, 14)]
      : []),
  ]
    .sort()
    .at(-1);
  // Intake [start,end) bounded by morning weigh-ins; review-day food is excluded.
  const weighed = logs.filter(
    (l) =>
      l.date >= start &&
      l.date <= reviewDate &&
      number(l.weight) &&
      +l.weight >= 35 &&
      +l.weight <= 350,
  );
  if (
    weighed.length < 8 ||
    daysBetween(weighed[0].date, weighed.at(-1).date) < 14
  )
    return {
      ...learning,
      reason: "Need eight weigh-ins spanning 14 days after the first week.",
    };
  const first = weighed[0].date,
    end = weighed.at(-1).date,
    days = daysBetween(first, end);
  const map = new Map(logs.map((l) => [l.date, l]));
  const interval = Array.from({ length: days }, (_, i) =>
    map.get(addDays(first, i)),
  );
  if (
    interval.some(
      (l) =>
        !l ||
        l.foodComplete !== true ||
        l.activityComplete !== true ||
        !number(l.steps) ||
        !Number.isInteger(+l.steps) ||
        +l.steps < 0 ||
        +l.steps > 100000,
    )
  )
    return {
      ...learning,
      reason:
        "Calibration paused: every day between weigh-ins needs complete food and steps.",
    };
  const normalizedIntake = mean(
    interval.map((l) => intake(l) - activityAdjustment(profile, l, weight)),
  );
  const measured = normalizedIntake - slope(weighed) * POLICY.density;
  if (measured < prior * 0.65 || measured > prior * 1.35)
    return {
      ...learning,
      reason:
        "Food and weight signals disagree strongly; check logging before adjusting.",
    };
  const confidence = Math.min(0.75, days / 42);
  const limit = Math.min(
    prior * 0.2,
    100 * (1 + Math.floor((daysBetween(learningStart, reviewDate) - 28) / 7)),
  );
  return {
    maintenance: prior + clamp((measured - prior) * confidence, -limit, limit),
    source: "calibrated",
    measured,
    days,
    reason: `Calibrated from ${days} complete days, normalized to baseline steps.`,
  };
}
function reachedOn(profile, logs, asOf) {
  return (
    weightTrend(logs, asOf).find(
      (p) =>
        daysBetween(profile.startDate, p.date) >= 7 &&
        p.samples >= 3 &&
        p.trend <= +profile.goalWeight,
    )?.date ?? null
  );
}
export function buildPlan(profile, allLogs, date = today()) {
  if (!validDate(date)) throw new Error("Choose a valid calendar date.");
  const errors = validateProfile(profile);
  if (errors.length) throw new Error(errors.join(" "));
  const availableLogs = cleanLogs(allLogs, date);
  const logs = availableLogs.filter((l) => l.date >= profile.startDate);
  const elapsed = Math.max(0, daysBetween(profile.startDate, date));
  const reviewDate = addDays(profile.startDate, Math.floor(elapsed / 7) * 7);
  const history = logs.filter((l) => l.date <= reviewDate);
  const recentTrend = weightTrend(history, reviewDate);
  const weight = recentTrend.at(-1)?.trend ?? +profile.startWeight;
  const prior = formulaMaintenance(profile, weight);
  const reachedDate = reachedOn(profile, logs, date);
  const calibration = calibrate(
    { ...profile, maintenanceSince: profile.maintenanceSince || reachedDate },
    history,
    reviewDate,
    weight,
    prior,
  );
  const baselineMaintenance = Math.round(calibration.maintenance);
  const manualMaintenance =
    validDate(profile.maintenanceSince) && profile.maintenanceSince <= date;
  const phase =
    reachedDate || manualMaintenance
      ? "maintenance"
      : date < profile.startDate
        ? "scheduled"
        : "cut";
  const daysLeft = daysBetween(reviewDate, profile.goalDate);
  const originalRate =
    (+profile.startWeight - +profile.goalWeight) /
    daysBetween(profile.startDate, profile.goalDate);
  const requestedDeficit =
    phase !== "cut"
      ? 0
      : POLICY.density *
        (daysLeft > 0
          ? Math.max(0, weight - +profile.goalWeight) / daysLeft
          : originalRate);
  // Product guardrails, not individual medical safety guarantees. BMR is not an intake floor.
  const intakeFloor = profile.sex === "male" ? 1500 : 1200;
  const capacity = Math.max(
    0,
    Math.min(
      (weight * POLICY.maxWeeklyFraction * POLICY.density) / 7,
      baselineMaintenance * POLICY.maxDeficitFraction,
      baselineMaintenance - intakeFloor,
    ),
  );
  const deficit = Math.round(Math.min(requestedDeficit, capacity));
  const log = availableLogs.find((l) => l.date === date);
  const activity = Math.round(activityAdjustment(profile, log, weight));
  const maintenance = baselineMaintenance + activity;
  const target = Math.max(intakeFloor, maintenance - deficit);
  const actualDeficit = maintenance - target;
  const currentTrend = weightTrend(logs, date).at(-1);
  const currentWeight = currentTrend?.trend ?? +profile.startWeight;
  const remaining = Math.max(0, currentWeight - +profile.goalWeight);
  const projectedDays =
    actualDeficit > 0
      ? Math.ceil((remaining * POLICY.density) / actualDeficit)
      : null;
  const desiredProtein = Math.round(
    Math.min(currentWeight, +profile.goalWeight * 1.1) *
      (phase === "maintenance" ? 1.8 : 2),
  );
  const protein = Math.min(desiredProtein, Math.floor((target * 0.4) / 4));
  const fat = Math.round((target * 0.25) / 9);
  const carbs = Math.max(0, Math.round((target - protein * 4 - fat * 9) / 4));
  const warnings = [];
  if (phase === "scheduled")
    warnings.push(
      `Your cut starts on ${profile.startDate}. Until then, this is a maintenance allowance.`,
    );
  if (protein < desiredProtein)
    warnings.push(
      "This calorie allowance limits the protein guide. Review the calorie plan rather than forcing incompatible macro targets.",
    );
  if (requestedDeficit > capacity + 1)
    warnings.push(
      "The deadline needs a larger deficit than this app allows. Use the later estimate or extend your goal date.",
    );
  if (phase === "cut" && date >= profile.goalDate)
    warnings.push(
      "The deadline has passed. Continue a bounded cut or switch to maintenance; do not chase the date with a crash diet.",
    );
  if (actualDeficit < deficit)
    warnings.push(
      activity < 0
        ? "Lower activity reached the food minimum. Your estimated deficit is smaller today; do not force it by eating less."
        : "The estimated expenditure is too low to fit a cut within the food minimum. Review your profile and maintenance estimate.",
    );
  if (phase === "maintenance")
    warnings.push(
      "Eat at estimated maintenance now. Keep lifting and protein consistent. Early water and glycogen regain is expected; judge the trend over 2–4 weeks.",
    );
  if (phase === "cut" && elapsed >= 84)
    warnings.push(
      "You have been cutting for 12 weeks. Review recovery and consider a maintenance break.",
    );
  const trend = weightTrend(logs, date);
  const recent = trend.filter((t) => t.date >= addDays(date, -13));
  const observedWeeklyLoss =
    recent.length >= 6 && daysBetween(recent[0].date, recent.at(-1).date) >= 10
      ? -slope(recent.map((t) => ({ date: t.date, weight: t.raw }))) * 7
      : null;
  if (
    phase === "cut" &&
    elapsed >= 21 &&
    observedWeeklyLoss > currentWeight * 0.01
  )
    warnings.push(
      "Recent loss exceeds 1% of body weight per week. Review recovery and consider maintenance.",
    );
  return {
    date,
    phase,
    reachedDate,
    reviewDate,
    nextReview: addDays(reviewDate, 7),
    bmr: Math.round(restingEnergy(profile, weight)),
    baselineMaintenance,
    maintenance,
    activity,
    deficit: actualDeficit,
    plannedDeficit: deficit,
    target,
    baselineTarget: baselineMaintenance - deficit,
    currentWeight,
    weightSamples: currentTrend?.samples ?? 0,
    protein,
    fat,
    carbs,
    consumed: intake(log),
    remaining: target - intake(log),
    requestedDeficit: Math.round(requestedDeficit),
    projectedDate:
      phase === "cut" && projectedDays != null
        ? addDays(date, projectedDays)
        : null,
    observedWeeklyLoss,
    calibration,
    warnings,
    trend,
    provisional: !log?.activityComplete,
    stepKcal: stepEnergy(profile, weight),
  };
}
