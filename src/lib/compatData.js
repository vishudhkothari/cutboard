import { normalizeProfile, numeric, validDate } from "./modelInputs.js";

// A v2 timestamp belongs to the whole document, not its profile or each day.
// Preserve both stores; a meal edit cannot establish which profile is correct.
export function restoredSetup(classic, document, newer = false) {
  const p = document?.profile;
  if (!p || (classic && (classic.modelVersion >= 3 || !newer || document.needsProfileReview)))
    return classic || null;
  const days = Math.round(
    (Date.parse(p.goalDate) - Date.parse(p.startDate)) / 86400000,
  );
  const mapped = {
    name: p.name,
    age: p.age,
    height: p.height,
    sex: p.sex,
    startWeight: p.startWeight,
    goalWeight: p.goalWeight,
    startDate: p.startDate,
    cutLength: days,
    stepGoal: p.baselineSteps,
    activity: p.activity || "",
    startBF: null,
    goalBF: null,
    trainingDays: [],
  };
  if (!classic) return {
    ...mapped, profileNeedsReview: true,
    profileReviewIssues: ["Review the restored profile, including your usual activity level, before using a calorie target."],
  };
  const original = normalizeProfile(classic).value;
  const conflicts = [];
  for (const [key, label] of [
    ["age", "age"], ["height", "height"], ["sex", "sex"],
    ["startWeight", "starting weight"], ["goalWeight", "target weight"],
    ["startDate", "start date"], ["cutLength", "cut length"], ["stepGoal", "usual steps"], ["activity", "activity"],
  ]) {
    if (mapped[key] == null || mapped[key] === "" || (key === "cutLength" && !Number.isFinite(days))) continue;
    const a = numeric(original[key]) ?? String(original[key]).toLowerCase();
    const b = numeric(mapped[key]) ?? String(mapped[key]).toLowerCase();
    if (a !== b) conflicts.push(`${label} (${original[key] ?? "unset"} / ${mapped[key]})`);
  }
  return conflicts.length ? {
    ...classic, profileNeedsReview: true,
    profileReviewIssues: [`Saved versions disagree on ${conflicts.join(", ")}. The original values are shown below. Review them and save the correct profile.`],
  } : classic;
}

const stableJSON = value => JSON.stringify(value ?? null, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item);
const sameMeal = (a, b) => ["name", "cals", "protein", "carbs", "fat", "fiber"].every(key =>
  key === "name" ? (a?.[key] || "") === (b?.[key] || "") :
    (numeric(a?.[key]) ?? 0) === (numeric(b?.[key]) ?? 0)) &&
  ["foodId", "recipeId", "micros"].every(key=>stableJSON(a?.[key])===stableJSON(b?.[key])) &&
  numeric(a?.amount)===numeric(b?.amount);
function changedFacts(original, imported) {
  const fields = [];
  for (const key of ["weight", "steps", "sleep"])
    if (Object.hasOwn(imported, key) && numeric(imported[key]) !== numeric(original[key])) fields.push(key);
  if (Array.isArray(imported.meals) && (
    imported.meals.length !== (original.meals || []).length ||
    imported.meals.some((meal, i) => !sameMeal(meal, original.meals?.[i]))
  )) fields.push("meals");
  for (const key of ["foodComplete", "activityComplete"])
    if (Object.hasOwn(imported, key) && (imported[key] === true) !== (original[key] === true)) fields.push(key);
  for (const key of ["notes", "measurements", "sleepQuality", "zone2Sessions"])
    if (Object.hasOwn(imported,key) && stableJSON(imported[key])!==stableJSON(original[key])) fields.push(key);
  return fields;
}

export function restoredLogs(rows, documentRow) {
  const classic = new Map(
    rows
      .filter((r) => r.key?.startsWith("log:") && r.value?.date)
      .map((r) => [r.value.date, r]),
  );
  for (const log of documentRow?.value?.logs || []) {
    if (!validDate(log?.date)) continue;
    const old = classic.get(log.date);
    if (old?.value?.planSnapshot?.modelVersion >= 3) continue;
    if (
      old &&
      (!documentRow.updated_at ||
        (old.updated_at && old.updated_at >= documentRow.updated_at))
    )
      continue;
    const fields = old ? changedFacts(old.value, log) : [];
    if (old && !fields.length) continue;
    classic.set(log.date, {
      key: `log:${log.date}`,
      value: { ...old?.value, ...log, planSnapshot: null,
        ...(fields.length ? {recordNeedsReview:true,recordReviewFields:fields} : {}),
      },
    });
  }
  return [...classic.values()]
    .map((r) => r.value)
    .sort((a, b) => a.date.localeCompare(b.date));
}
