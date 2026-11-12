// Read the short-lived v2 document without replacing the original account rows.
// Classic-only fields (sleep, measurements, snapshots and historical metadata) survive the bridge.
export function restoredSetup(classic, document, newer = false) {
  if (
    classic &&
    (classic.modelVersion >= 3 || !newer || document?.needsProfileReview)
  )
    return classic;
  const p = document?.profile;
  if (!p) return classic || null;
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
    cutLength: Number.isFinite(days) && days > 0 ? days : 60,
    stepGoal: p.baselineSteps ?? 10000,
    activity: "mod",
    startBF: null,
    goalBF: 12,
    trainingDays: [],
  };
  return classic
    ? {
        ...classic,
        ...Object.fromEntries(
          Object.entries(mapped).filter(
            ([key, value]) =>
              value != null &&
              !["startBF", "goalBF", "activity", "trainingDays"].includes(key),
          ),
        ),
      }
    : mapped;
}

export function restoredLogs(rows, documentRow) {
  const classic = new Map(
    rows
      .filter((r) => r.key?.startsWith("log:") && r.value?.date)
      .map((r) => [r.value.date, r]),
  );
  for (const log of documentRow?.value?.logs || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(log?.date)) continue;
    const old = classic.get(log.date);
    if (old?.value?.planSnapshot?.modelVersion >= 3) continue;
    if (
      old &&
      (!documentRow.updated_at ||
        (old.updated_at && old.updated_at >= documentRow.updated_at))
    )
      continue;
    // No copied prescription: a v2 factual edit invalidates the old snapshot.
    classic.set(log.date, {
      key: `log:${log.date}`,
      value: { ...old?.value, ...log, planSnapshot: null },
    });
  }
  return [...classic.values()]
    .map((r) => r.value)
    .sort((a, b) => a.date.localeCompare(b.date));
}
