import { addDays, today, validDate } from "./cutEngine.js";

export const emptyState = () => ({ version: 2, profile: null, logs: [] });
export const emptyLog = (date) => ({
  date,
  weight: null,
  steps: null,
  trained: false,
  meals: [],
  foodComplete: false,
  activityComplete: false,
  notes: "",
});

// Import facts, never old prescriptions. Leave all original account rows intact.
export function migrateLegacy(rows) {
  const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const s = values.setup;
  if (!s) return emptyState();
  const start = validDate(s.startDate) ? s.startDate : today();
  const goal =
    s.goalWeight ||
    (s.startBF && s.goalBF
      ? Math.round(
          ((s.startWeight * (1 - s.startBF / 100)) / (1 - s.goalBF / 100)) * 10,
        ) / 10
      : "");
  return {
    version: 2,
    needsProfileReview: true,
    profile: {
      name: s.name || "",
      age: s.age,
      height: s.height,
      sex: s.sex || "male",
      startWeight: s.startWeight,
      goalWeight: goal,
      startDate: start,
      goalDate: addDays(start, Number(s.cutLength) || 60),
      baselineSteps: s.stepGoal ?? 10000,
      gymDays: s.trainingDays?.length ?? 5,
      gymMinutes: 60,
      maintenanceOverride: "",
    },
    logs: rows
      .filter((r) => r.key.startsWith("log:") && validDate(r.value?.date))
      .map((r) => ({
        date: r.value.date,
        weight: r.value.weight ?? null,
        steps: r.value.steps ?? null,
        meals: r.value.meals || [],
        trained: false,
        notes: r.value.notes || "",
        foodComplete: false,
        activityComplete: false,
      })),
  };
}

export function validateState(s) {
  const validNumber = (value, min, max) =>
    (typeof value === "number" ||
      (typeof value === "string" && value.trim() !== "")) &&
    Number.isFinite(+value) &&
    +value >= min &&
    +value <= max;
  if (
    !s ||
    s.version !== 2 ||
    !Array.isArray(s.logs) ||
    (s.profile !== null &&
      (typeof s.profile !== "object" || Array.isArray(s.profile)))
  )
    throw new Error(
      "Unsupported CUTIQ data format. Your stored data has not been changed.",
    );
  if (
    s.logs.some(
      (l) =>
        !l ||
        !validDate(l.date) ||
        (l.weight != null && !validNumber(l.weight, 35, 350)) ||
        (l.steps != null &&
          (!validNumber(l.steps, 0, 100000) || !Number.isInteger(+l.steps))) ||
        (l.activityComplete === true && l.steps == null) ||
        ["trained", "foodComplete", "activityComplete"].some(
          (key) => l[key] != null && typeof l[key] !== "boolean",
        ) ||
        (l.notes != null && typeof l.notes !== "string") ||
        !Array.isArray(l.meals) ||
        l.meals.some(
          (m) =>
            !m ||
            typeof m.name !== "string" ||
            !validNumber(m.cals, 0, 100000) ||
            (m.protein != null && !validNumber(m.protein, 0, 10000)),
        ),
    )
  )
    throw new Error(
      "A saved day contains invalid data. Export and inspect the backup before continuing.",
    );
  if (new Set(s.logs.map((l) => l.date)).size !== s.logs.length)
    throw new Error(
      "Saved data contains duplicate dates. Your stored data has not been changed.",
    );
  return s;
}
