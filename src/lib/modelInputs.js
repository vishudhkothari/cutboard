// Normalize facts at the model boundary. Never write these copies on load.
export const numeric = (value) => {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};
export const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const time = Date.parse(`${value}T12:00:00Z`);
  return (
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
  );
};
const between = (value, min, max) =>
  value != null && value >= min && value <= max;
const optional = (value) => value == null || value === "";

export function normalizeProfile(raw) {
  if (!raw || typeof raw !== "object")
    return {
      value: null,
      errors: ["Set up a profile before calculating a calorie target."],
    };
  const value = { ...raw };
  const errors = [];
  if (raw.profileNeedsReview)
    errors.push(...(raw.profileReviewIssues?.length ? raw.profileReviewIssues : ["Review and save the restored profile before calculating a target."]));
  for (const [key, label, min, max] of [
    ["age", "Age", 18, 100],
    ["height", "Height in centimetres", 100, 250],
    ["startWeight", "Starting weight in kilograms", 35, 350],
    ["cutLength", "Cut length in days", 14, 365],
    ["stepGoal", "Usual daily steps", 0, 100000],
  ]) {
    value[key] = numeric(raw[key]);
    if (!between(value[key], min, max))
      errors.push(`${label} must be between ${min} and ${max}.`);
  }
  for (const key of ["stepGoal", "cutLength"])
    if (value[key] != null && !Number.isInteger(value[key]))
      errors.push(`${key === "stepGoal" ? "Usual daily steps" : "Cut length in days"} must be a whole number.`);
  value.sex = typeof raw.sex === "string" ? raw.sex.toLowerCase() : null;
  if (!["male", "female"].includes(value.sex))
    errors.push("Choose a sex for the resting-energy equation.");
  if (!validDate(raw.startDate)) errors.push("Choose a valid cut start date.");
  if (!["sed", "light", "mod", "active", "extra"].includes(raw.activity))
    errors.push("Choose an activity level for your usual routine.");
  value.startBF = numeric(raw.startBF);
  value.goalBF = numeric(raw.goalBF);
  if (!optional(raw.startBF) && raw.startBF !== 0 && raw.startBF !== "0" && !between(value.startBF, 3, 65))
    errors.push("Starting body fat must be between 3 and 65 percent, or left blank.");
  if (!optional(raw.goalBF) && raw.goalBF !== 0 && raw.goalBF !== "0" && !between(value.goalBF, 3, 60))
    errors.push("Goal body fat must be between 3 and 60 percent, or left blank.");
  if (!between(value.startBF, 3, 65)) value.startBF = null;
  if (!between(value.goalBF, 3, 60)) value.goalBF = null;
  value.goalWeight = numeric(raw.goalWeight);
  value.goalSource = "scale";
  if (
    optional(raw.goalWeight) &&
    value.startBF != null &&
    value.goalBF != null &&
    value.goalBF < value.startBF &&
    value.startWeight != null
  ) {
    // Starting composition defines one fixed fallback goal. Daily modeled lean
    // loss and strength reports must never silently move that goal.
    value.goalWeight =
      Math.round(
        ((value.startWeight * (1 - value.startBF / 100)) /
          (1 - value.goalBF / 100)) *
          10,
      ) / 10;
    value.goalSource = "starting_body_fat";
  }
  if (
    !between(value.goalWeight, 35, 350) ||
    value.goalWeight >= value.startWeight
  )
    errors.push(
      "Set a target weight below the starting weight (at least 35 kg), or valid starting and goal body-fat values.",
    );
  value.manualCalTarget = optional(raw.manualCalTarget)
    ? null
    : numeric(raw.manualCalTarget);
  if (
    !optional(raw.manualCalTarget) &&
    !between(value.manualCalTarget, 1000, 6000)
  )
    errors.push(
      "The manual calorie target must be between 1,000 and 6,000, or left blank.",
    );
  value.userMaxStepBudget = numeric(raw.userMaxStepBudget) ?? 14000;
  const referenceSteps = numeric(raw.activityReferenceSteps);
  value.activityReferenceSteps = between(referenceSteps, 0, 100000)
    ? Math.round(referenceSteps) : value.stepGoal;
  value.userMaxStepBudget = Math.round(Math.max(
    value.stepGoal ?? 0,
    Math.min(100000, Math.max(0, value.userMaxStepBudget)),
  ));
  for (const key of ["maintenanceSince", "calibrationSince", "goalChangedAt"])
    if (value[key] && !validDate(value[key])) {
      value[key] = null;
    }
  return { value, errors };
}

export function normalizeLog(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object" || !validDate(raw.date))
    return { value: null, errors: ["A log has an invalid calendar date."] };
  const value = { ...raw };
  for (const [key, label, min, max] of [
    ["weight", "Weight in kilograms", 35, 350],
    ["steps", "Step count", 0, 100000],
    ["sleep", "Sleep hours", 0, 24],
  ]) {
    value[key] = numeric(raw[key]);
    if (!optional(raw[key]) && !between(value[key], min, max)) {
      errors.push(`${raw.date}: ${label} is invalid.`);
      value[key] = null;
    }
  }
  if (value.steps != null && !Number.isInteger(value.steps)) {
    errors.push(`${raw.date}: steps must be a whole number.`);
    value.steps = null;
  }
  if (raw.meals != null && !Array.isArray(raw.meals))
    errors.push(`${raw.date}: meal data is invalid.`);
  value.meals = (Array.isArray(raw.meals) ? raw.meals : []).map(
    (meal, index) => {
      const next = {
        ...meal,
        name: typeof meal?.name === "string" ? meal.name : "",
      };
      for (const key of ["cals", "protein", "carbs", "fat", "fiber"]) {
        const number = numeric(meal?.[key]);
        const absent = key !== "cals" && optional(meal?.[key]);
        if (!absent && !between(number, 0, key === "cals" ? 100000 : 10000))
          errors.push(`${raw.date}: meal ${index + 1} has invalid ${key}.`);
        next[key] = absent ? 0 : number;
      }
      return next;
    },
  );
  value.foodComplete =
    raw.foodComplete === true &&
    !errors.some((error) => error.includes("meal"));
  value.activityComplete = raw.activityComplete === true && value.steps != null;
  return { value, errors };
}

export function normalizeLogs(logs, { startDate, endDate } = {}) {
  const byDate = new Map(),
    errors = [];
  for (const raw of Array.isArray(logs) ? logs : []) {
    const result = normalizeLog(raw);
    errors.push(...result.errors);
    if (!result.value) continue;
    const log = result.value;
    if (
      (!startDate || log.date >= startDate) &&
      (!endDate || log.date <= endDate)
    )
      byDate.set(log.date, log);
  }
  return {
    value: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    errors,
  };
}

export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : null;
};

// Keep the recorded facts; exclude isolated errors only from inferred metrics.
export function weightEvidence(logs) {
  const weighed = logs.filter((log) => between(log.weight, 35, 350));
  const accepted = [],
    outliers = [];
  for (const log of weighed) {
    const time = Date.parse(log.date);
    const neighbours = weighed
      .filter(
        (other) =>
          other !== log &&
          Math.abs(Date.parse(other.date) - time) <= 4 * 86400000,
      )
      .map((other) => other.weight);
    const center = median(neighbours),
      mad =
        center == null
          ? null
          : median(neighbours.map((weight) => Math.abs(weight - center)));
    if (
      neighbours.length >= 3 &&
      Math.abs(log.weight - center) > Math.max(1, 4.5 * mad)
    )
      outliers.push(log.date);
    else accepted.push(log);
  }
  return { accepted, outliers };
}
