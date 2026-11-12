import test from "node:test";
import assert from "node:assert/strict";
import {
  STEP_KCAL_PER_1000,
  today,
  shiftDay,
  hasSteps,
  movementCredit,
  getAdaptiveTDEE,
  getPlanForDate,
  createPlanSnapshot,
  getDynamicStepGoal,
} from "./planEngine.js";
import {
  buildDayPlan,
  zigzagWeek,
  estimateTDEE,
  evaluateMuscleRisk,
  inferBodyComp,
  projectGoal,
} from "./cutEngine.js";
import { restoredSetup, restoredLogs } from "./compatData.js";

const date = today();
const setup = {
  age: 30,
  height: 180,
  sex: "male",
  startWeight: 85,
  startBF: 20,
  goalWeight: 79,
  startDate: date,
  cutLength: 77,
  stepGoal: 10000,
  activity: "mod",
  manualCalTarget: 2000,
};
const day = (fields = {}) => ({ date, steps: 10000, meals: [], ...fields });
const plan = (log, extra = {}) =>
  getPlanForDate({ date: log.date, log, setup, logs: [log], ...extra });

test("the chosen step credit is exactly 40 kcal per thousand above baseline", () => {
  assert.equal(STEP_KCAL_PER_1000, 40);
  assert.equal(movementCredit(setup, day({ steps: 15000 }), 85).total, 200);
  assert.equal(plan(day({ steps: 15000 })).eatTarget, 2200);
  assert.equal(plan(day({ steps: 10000 })).eatTarget, 2000);
});

test("2600 maintenance, 2000 food and five thousand extra steps keep the 600 deficit", () => {
  const result = buildDayPlan({
    baseTarget: 2000,
    maintenance: 2800,
    floor: 1500,
    activityCredit: 200,
  });
  assert.equal(result.eatTarget, 2200);
  assert.equal(result.deficit, 600);
});

test("ordinary activity and gym are not added to baseline expenditure twice", () => {
  const a = getAdaptiveTDEE(setup, [day()], {}, date);
  const b = getAdaptiveTDEE(
    { ...setup, gymDays: 5 },
    [day({ trained: true })],
    {},
    date,
  );
  assert.equal(a.base, b.base);
  assert.equal(a.activityCredit, 0);
});

test("today partial steps do not debit food; finalized low steps do", () => {
  assert.equal(plan(day({ steps: 5000 })).eatTarget, 2000);
  const finalized = day({ steps: 5000, activityComplete: true });
  assert.equal(plan(finalized).eatTarget, 1800);
  const yesterday = shiftDay(date, -1);
  assert.equal(
    plan(day({ date: yesterday, steps: 5000 }), {
      setup: { ...setup, startDate: yesterday },
    }).eatTarget,
    1800,
  );
});

test("missing step count is unknown rather than a zero-step day", () => {
  for (const steps of [null, undefined, "", NaN]) {
    assert.equal(hasSteps({ steps }), false);
    assert.equal(
      movementCredit(setup, day({ steps, activityComplete: true }), 85).total,
      0,
    );
  }
  assert.equal(hasSteps({ steps: 0 }), true);
});

test("scheduled incline earns nothing until completed, and overlapping steps are credited once", () => {
  const active = { ...setup, activeCut: true, cardioMin: 35 };
  const a = getAdaptiveTDEE(active, [day()], {}, date);
  assert.equal(a.cardioCredit, 0);
  assert.equal(a.target, 2000);
  const movement = movementCredit(
    active,
    day({ steps: 15000, inclineMin: 35 }),
    85,
  );
  assert.equal(movement.cardioBurn, 238);
  assert.equal(movement.overlapSteps, 3150);
  assert.equal(movement.total, 200 + 238 - 126);
  assert.equal(
    plan(day({ steps: 15000, inclineMin: 35 }), { setup: active }).eatTarget,
    2312,
  );
});

test("food floor wins and the displayed deficit reflects the smaller achieved plan", () => {
  const log = day({ steps: 0, activityComplete: true });
  const result = plan(log, { setup: { ...setup, manualCalTarget: 1600 } });
  assert.equal(result.eatTarget, 1500);
  assert.equal(result.deficit, result.maintenance - 1500);
});

test("zigzag preserves the exact weekly mean even when low days meet the floor", () => {
  for (const target of [1200, 1500, 1501, 1550, 1800, 2400])
    for (const schedule of [1, 2])
      for (const mode of ["mild", "weight", "extreme"]) {
        const week = zigzagWeek(target, schedule, mode, 1500);
        assert.equal(
          week.reduce((s, d) => s + d.cals, 0),
          7 * Math.max(1500, target),
        );
        assert.ok(
          week.every((d) => Number.isInteger(d.cals) && d.cals >= 1500),
        );
      }
});

test("activity credit is added after the zigzag pattern without changing its planned deficit", () => {
  for (const mode of ["mild", "weight", "extreme"]) {
    const a = plan(day(), { zigzagSettings: { on: true, schedule: 1, mode } });
    const b = plan(day({ steps: 15000 }), {
      zigzagSettings: { on: true, schedule: 1, mode },
    });
    assert.equal(b.eatTarget - a.eatTarget, 200);
    assert.equal(b.deficit, a.deficit);
  }
});

test("fasting schedule, manual overrides and compensation retain their original behavior", () => {
  const settings = { fastingDays: [new Date(date + "T12:00:00").getDay()] };
  assert.equal(plan(day(), { planSettings: settings }).eatTarget, 0);
  assert.equal(
    plan(day({ fastingOverridden: true }), { planSettings: settings })
      .eatTarget,
    2000,
  );
  const result = plan(
    day({ steps: 15000, fasting: true, meals: [{ cals: 300 }] }),
    { planSettings: { fastCompensation: true } },
  );
  assert.equal(result.eatTarget, 550);
  assert.equal(result.deficit, result.maintenance - 550);
});

test("today snapshots do not freeze an older calorie allowance; captured history does", () => {
  const log = day({
    steps: 15000,
    planSnapshot: { eatTarget: 1900, effMaint: 2500, source: "captured" },
  });
  assert.equal(plan(log).eatTarget, 2200);
  const historical = { ...log, date: shiftDay(date, -2) };
  assert.equal(plan(historical).eatTarget, 1900);
  assert.equal(plan(historical).deficit, 600);
  assert.equal(
    createPlanSnapshot({ date, log, setup, logs: [log] }).eatTarget,
    2200,
  );
});

test("reconstructed history can be corrected and future records never affect a past plan", () => {
  const past = shiftDay(date, -7);
  const old = day({
    date: past,
    planSnapshot: { eatTarget: 9000, source: "reconstructed" },
  });
  const s = { ...setup, startDate: past };
  const a = plan(old, { setup: s });
  const b = plan(old, {
    setup: s,
    logs: [old, day({ weight: 50, steps: 60000 })],
  });
  assert.equal(a.eatTarget, 2000);
  assert.equal(b.eatTarget, a.eatTarget);
  assert.equal(b.maintenance, a.maintenance);
});

test("weekly reviews hold the baseline steady between reviews", () => {
  const s = { ...setup, startDate: shiftDay(date, -4), manualCalTarget: "" };
  const a = getAdaptiveTDEE(s, [], {}, date);
  const b = getAdaptiveTDEE(s, [day({ weight: 82 })], {}, date);
  assert.equal(a.target, b.target);
  assert.equal(a.base, b.base);
});

test("deadline requests are limited rather than forcing an extreme deficit", () => {
  const s = { ...setup, manualCalTarget: "", goalWeight: 60, cutLength: 3 };
  const result = getAdaptiveTDEE(s, [], {}, date);
  assert.ok(result.goalTooAggressive);
  assert.ok(result.deficit <= result.base * 0.25 + 1);
  assert.ok(result.target >= result.floor);
});

test("deadline and confirmed goal transition directly to maintenance", () => {
  const s = { ...setup, startDate: shiftDay(date, -20), cutLength: 20 };
  const deadline = getAdaptiveTDEE(s, [], {}, date);
  assert.equal(deadline.phase, "maintenance");
  assert.equal(deadline.target, deadline.base);
  const reached = getAdaptiveTDEE(
    { ...s, cutLength: 77 },
    [-2, -1, 0].map((i) => day({ date: shiftDay(date, i), weight: 78.8 })),
    {},
    date,
  );
  assert.equal(reached.phase, "maintenance");
  const latched = getAdaptiveTDEE(
    { ...s, cutLength: 77, maintenanceSince: shiftDay(date, -1) },
    [day({ weight: 80 })],
    {},
    date,
  );
  assert.equal(latched.phase, "maintenance");
});

test("one low weigh-in cannot end the cut", () => {
  const result = getAdaptiveTDEE(
    { ...setup, startDate: shiftDay(date, -20) },
    [day({ weight: 78 })],
    {},
    date,
  );
  assert.equal(result.phase, "cut");
});

const series = () =>
  Array.from({ length: 36 }, (_, i) => ({
    date: shiftDay("2026-01-01", i),
    weight: 85 - (i * 600) / 7700,
    steps: 15000,
    meals: [{ cals: 2000 }],
  }));
const estimateOptions = {
  fatFraction: (7700 - 1800) / (9400 - 1800),
  activityForLog: () => 200,
};
test("learning uses actual intake, aligned morning-to-morning weights and normalized movement", () => {
  const result = estimateTDEE(series(), estimateOptions);
  assert.equal(result.tdee, 2400);
  assert.equal(result.avgIntake, 2000);
  assert.equal(result.normalizedIntake, 1800);
});

test("missing food days, explicit incomplete food and implausibly low logs block calibration", () => {
  for (const change of [
    (logs) => logs.splice(25, 1),
    (logs) => {
      logs[25].foodComplete = false;
    },
    (logs) => {
      logs[25].meals = [];
    },
    (logs) => {
      logs[25].meals = [{ cals: 200 }];
    },
  ]) {
    const logs = series();
    change(logs);
    assert.equal(estimateTDEE(logs, estimateOptions), null);
  }
});

test("fasting estimates use actual meals rather than prescribed fast calories", () => {
  const logs = series();
  logs[25] = { ...logs[25], fasting: true, meals: [{ cals: 300 }] };
  const a = estimateTDEE(logs, {
    ...estimateOptions,
    fastComp: true,
    fastKcal: 500,
  });
  const b = estimateTDEE(logs, {
    ...estimateOptions,
    fastComp: false,
    fastKcal: 0,
  });
  assert.deepEqual(a, b);
  assert.ok(a.avgIntake < 2000);
});

test("step compensation does not count a logged movement credit twice", () => {
  const yesterday = shiftDay(date, -1);
  const logs = [
    day({ date: yesterday, steps: 15000, meals: [{ cals: 2400 }] }),
    day(),
  ];
  const result = getDynamicStepGoal(
    { ...setup, startDate: yesterday },
    logs,
    null,
    {},
    {},
    null,
    logs[1],
  );
  assert.equal(result.outstandingKcal, 200);
  assert.equal(result.capped, true);
});

test("empty food days cannot clear previous compensation", () => {
  const old = shiftDay(date, -2);
  const logs = [
    day({ date: old, meals: [{ cals: 2300 }] }),
    day({ date: shiftDay(date, -1) }),
    day(),
  ];
  const result = getDynamicStepGoal(
    { ...setup, startDate: old },
    logs,
    null,
    {},
    {},
    null,
    logs[2],
  );
  assert.equal(result.outstandingKcal, 300);
});

test("strength risk requires consecutive distinct weeks and numeric week ordering", () => {
  assert.equal(
    evaluateMuscleRisk({
      strengthReports: [
        { weekKey: 2, signal: "down" },
        { weekKey: 10, signal: "down" },
      ],
    }).confirmed,
    false,
  );
  assert.equal(
    evaluateMuscleRisk({
      strengthReports: [
        { weekKey: 9, signal: "down" },
        { weekKey: 10, signal: "down" },
      ],
    }).confirmed,
    true,
  );
  assert.equal(
    evaluateMuscleRisk({
      strengthReports: [
        { weekKey: 1, signal: "down" },
        { weekKey: 1, signal: "down" },
      ],
    }).confirmed,
    false,
  );
});

test("missing body-fat anchor cannot invent body composition", () => {
  assert.equal(
    inferBodyComp({
      logs: series(),
      anchor: { weight: 85, bf: null, date: "2026-01-01" },
    }),
    null,
  );
});

test("a flat trend already at the scale goal is reached rather than stalled", () => {
  const logs = series().map((l) => ({ ...l, weight: 79 }));
  const result = projectGoal({
    logs,
    currentWeight: 79,
    currentBF: 15,
    goalBF: 12,
    leanMass: 67,
    targetWeight: 79,
  });
  assert.equal(result.reached, true);
});

test("restoration keeps original settings and newer factual edits without losing classic-only fields", () => {
  const classic = { name: "Original", startBF: 20 };
  assert.equal(restoredSetup(classic, { profile: { name: "New" } }), classic);
  const rows = [
    {
      key: "log:2026-01-01",
      updated_at: "2026-01-01",
      value: {
        date: "2026-01-01",
        sleep: 8,
        steps: 8000,
        planSnapshot: { eatTarget: 1900 },
      },
    },
  ];
  const newer = {
    updated_at: "2026-01-02",
    value: {
      logs: [{ date: "2026-01-01", steps: 15000, meals: [{ cals: 2200 }] }],
    },
  };
  const [log] = restoredLogs(rows, newer);
  assert.equal(log.sleep, 8);
  assert.equal(log.steps, 15000);
  assert.equal(log.planSnapshot, null);
  rows[0].updated_at = "2026-01-03";
  assert.equal(restoredLogs(rows, newer)[0].steps, 8000);
});

test("a v2-only account retains its scale goal and does not acquire a fabricated body-fat reading", () => {
  const result = restoredSetup(null, {
    profile: {
      startDate: "2026-01-01",
      goalDate: "2026-03-19",
      goalWeight: 79,
      baselineSteps: 10000,
    },
  });
  assert.equal(result.goalWeight, 79);
  assert.equal(result.startBF, null);
  assert.equal(result.cutLength, 77);
});

test("a future maintenance latch cannot make historical calibration start early", () => {
  const s = {
    ...setup,
    startDate: shiftDay(date, -21),
    maintenanceSince: shiftDay(date, 7),
  };
  const logs = Array.from({ length: 22 }, (_, i) =>
    day({
      date: shiftDay(s.startDate, i),
      weight: 85 - i * 0.05,
      meals: [{ cals: 2000 }],
    }),
  );
  const result = getAdaptiveTDEE(s, logs, {}, date);
  assert.equal(result.phase, "cut");
  assert.equal(result.estimate, null);
});

test("missing movement blocks baseline calibration instead of inventing a step count", () => {
  const logs = series();
  logs[25].steps = null;
  const asOf = logs.at(-1).date;
  const result = getAdaptiveTDEE(
    { ...setup, startDate: logs[0].date },
    logs,
    {},
    asOf,
  );
  assert.equal(result.estimate, null);
});

test("partial food today does not erase compensation from a completed prior day", () => {
  const old = shiftDay(date, -1);
  const logs = [
    day({ date: old, meals: [{ cals: 2300 }] }),
    day({ meals: [{ cals: 500 }] }),
  ];
  const result = getDynamicStepGoal(
    { ...setup, startDate: old },
    logs,
    null,
    {},
    {},
    null,
    logs[1],
  );
  assert.equal(result.outstandingKcal, 300);
});

test("new classic edits cannot be replaced by an older v2 client whole-document save", () => {
  const classic = { ...setup, modelVersion: 3 };
  assert.equal(
    restoredSetup(classic, { profile: { goalWeight: 50 } }, true),
    classic,
  );
  const rows = [
    {
      key: `log:${date}`,
      updated_at: "2026-01-01",
      value: day({
        steps: 16000,
        planSnapshot: { modelVersion: 3, eatTarget: 2240 },
      }),
    },
  ];
  const newer = {
    updated_at: "2026-01-03",
    value: { logs: [day({ steps: 12000 })] },
  };
  assert.equal(restoredLogs(rows, newer)[0].steps, 16000);
});
