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
  restingEnergy,
} from "./planEngine.js";
import {
  buildDayPlan,
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
  goalBF: 12,
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
const full = (fields = {}) =>
  day({
    meals: [{ cals: 2000 }],
    foodComplete: true,
    activityComplete: true,
    ...fields,
  });
const series = (length = 36) =>
  Array.from({ length }, (_, i) =>
    full({
      date: shiftDay("2026-01-01", i),
      weight: 85 - (i * 600) / 7700,
      steps: 15000,
    }),
  );
const estimateOptions = {
  fatFraction: (7700 - 1800) / (9400 - 1800),
  activityForLog: () => 200,
};

test("40 kcal per thousand extra steps increases food and expenditure equally", () => {
  assert.equal(STEP_KCAL_PER_1000, 40);
  const a = plan(day()),
    b = plan(day({ steps: 15000 }));
  assert.equal(b.eatTarget, 2200);
  assert.equal(b.eatTarget - a.eatTarget, 200);
  assert.equal(b.maintenance - a.maintenance, 200);
  assert.equal(b.deficit, a.deficit);
});
test("the 2600 maintenance / 2000 food example preserves exactly 600 kcal deficit", () => {
  const result = buildDayPlan({
    baseTarget: 2000,
    maintenance: 2800,
    floor: 1500,
    activityCredit: 200,
  });
  assert.equal(result.eatTarget, 2200);
  assert.equal(result.deficit, 600);
});
test("usual steps and gym are already in the baseline and do not earn a second credit", () => {
  const a = getAdaptiveTDEE(setup, [day()], date),
    b = getAdaptiveTDEE(
      { ...setup, gymDays: 5 },
      [day({ trained: true })],
      date,
    );
  assert.equal(a.base, b.base);
  assert.equal(a.activityCredit, 0);
});
test("saved retired modes and incline logs cannot change the current budget", () => {
  const log = day({ steps: 15000, fasting: true, inclineMin: 600 });
  const result = plan(log, {
    setup: {
      ...setup,
      activeCut: true,
      activeCutDays: { [date]: true },
      cardioMin: 600,
    },
    planSettings: {
      fastingDays: [new Date().getDay()],
      fastCompensation: true,
    },
    zigzagSettings: { on: true, mode: "extreme" },
  });
  assert.equal(result.eatTarget, 2200);
  assert.equal("fasting" in result, false);
  assert.equal("regime" in result, false);
  assert.equal("activeCut" in getAdaptiveTDEE(setup, [log], date), false);
});
test("a partial low count does not debit food; finalized lower steps do", () => {
  assert.equal(plan(day({ steps: 5000 })).eatTarget, 2000);
  assert.equal(
    plan(day({ steps: 5000, activityComplete: true })).eatTarget,
    1800,
  );
  const yesterday = shiftDay(date, -1);
  assert.equal(
    plan(day({ date: yesterday, steps: 5000 }), {
      setup: { ...setup, startDate: yesterday },
    }).eatTarget,
    1800,
  );
  assert.equal(
    plan(day({ date: yesterday, steps: 5000, activityComplete: false }), {
      setup: { ...setup, startDate: yesterday },
    }).eatTarget,
    2000,
  );
});
test("missing, blank and invalid steps are unknown; a recorded zero is real", () => {
  for (const steps of [null, undefined, "", NaN, -1, 100001]) {
    assert.equal(hasSteps({ steps }), false);
    assert.equal(
      movementCredit(setup, day({ steps, activityComplete: true })).total,
      0,
    );
  }
  assert.equal(hasSteps({ steps: 0 }), true);
});
test("the food floor takes precedence and the displayed deficit uses the final target", () => {
  const result = plan(day({ steps: 0, activityComplete: true }), {
    setup: { ...setup, manualCalTarget: 1600 },
  });
  assert.equal(result.eatTarget, 1500);
  assert.equal(result.deficit, result.maintenance - 1500);
});
test("macro energy stays within rounding tolerance of the final food target", () => {
  for (const credit of [-400, -200, 0, 200, 800]) {
    const p = buildDayPlan({
      baseTarget: 2000,
      maintenance: 2600 + credit,
      floor: 1500,
      activityCredit: credit,
      currentWeightKg: 85,
    });
    assert.ok(
      Math.abs(p.proteinG * 4 + p.carbG * 4 + p.fatG * 9 - p.eatTarget) <= 7,
    );
  }
});
test("current-day snapshots cannot freeze activity; actual captured historical targets survive", () => {
  const log = day({
    steps: 15000,
    planSnapshot: { eatTarget: 1900, effMaint: 2500, source: "captured" },
  });
  assert.equal(plan(log).eatTarget, 2200);
  const old = { ...log, date: shiftDay(date, -2) };
  assert.equal(plan(old).eatTarget, 1900);
  assert.equal(plan(old).deficit, 600);
  assert.equal(
    createPlanSnapshot({ date, log, setup, logs: [log] }).eatTarget,
    2200,
  );
});
test("historical zero allowances stay historical and never switch on a live fasting mode", () => {
  const snapshot = { eatTarget: 0, effMaint: 2500, source: "captured" };
  assert.equal(
    plan(day({ date: shiftDay(date, -2), planSnapshot: snapshot })).eatTarget,
    0,
  );
  assert.equal(
    plan(day({ planSnapshot: snapshot, fasting: true })).eatTarget,
    2000,
  );
});
test("reconstructed targets can be corrected and future facts cannot alter a historical plan", () => {
  const past = shiftDay(date, -7),
    old = day({
      date: past,
      planSnapshot: { eatTarget: 9000, source: "reconstructed" },
    }),
    s = { ...setup, startDate: past };
  const a = plan(old, { setup: s }),
    b = plan(old, { setup: s, logs: [old, day({ weight: 50, steps: 60000 })] });
  assert.equal(a.eatTarget, 2000);
  assert.equal(b.eatTarget, a.eatTarget);
  assert.equal(b.maintenance, a.maintenance);
});
test("baseline food and expenditure hold steady between weekly reviews", () => {
  const s = { ...setup, startDate: shiftDay(date, -4), manualCalTarget: "" };
  const a = getAdaptiveTDEE(s, [], date),
    b = getAdaptiveTDEE(s, [day({ weight: 82 })], date);
  assert.equal(a.target, b.target);
  assert.equal(a.base, b.base);
});
test("an aggressive timeline is flagged and cannot force an extreme automatic deficit", () => {
  const result = getAdaptiveTDEE(
    { ...setup, manualCalTarget: "", goalWeight: 60, cutLength: 3 },
    [],
    date,
  );
  assert.ok(result.goalTooAggressive);
  assert.ok(result.deficit <= result.base * 0.25 + 1);
  assert.ok(result.target >= result.floor);
});
test("missing a deadline continues a bounded cut instead of declaring maintenance", () => {
  const s = {
    ...setup,
    startDate: shiftDay(date, -90),
    cutLength: 60,
    manualCalTarget: "",
  };
  const result = getAdaptiveTDEE(s, [], date);
  assert.equal(result.phase, "cut");
  assert.equal(result.deadlineMissed, true);
  assert.ok(result.deficit > 0);
  assert.ok(result.requestedDeficit < 600);
  assert.ok(result.target >= result.floor);
});
test("a confirmed scale goal returns directly to maintenance and ordinary rebound does not restart the cut", () => {
  const s = { ...setup, startDate: shiftDay(date, -20) };
  const logs = [-2, -1, 0].map((i) =>
    day({ date: shiftDay(date, i), weight: 78.8 }),
  );
  const reached = getAdaptiveTDEE(s, logs, date);
  assert.equal(reached.phase, "maintenance");
  assert.equal(reached.target, reached.base);
  const latched = getAdaptiveTDEE(
    { ...s, maintenanceSince: shiftDay(date, -1) },
    [day({ weight: 80 })],
    date,
  );
  assert.equal(latched.phase, "maintenance");
});
test("one abnormally low weight cannot confirm the scale goal among normal higher readings", () => {
  const s = { ...setup, startDate: shiftDay(date, -20) };
  assert.equal(getAdaptiveTDEE(s, [day({ weight: 78 })], date).phase, "cut");
  const logs = [
    day({ date: shiftDay(date, -2), weight: 85 }),
    day({ date: shiftDay(date, -1), weight: 85 }),
    day({ weight: 50 }),
  ];
  assert.equal(getAdaptiveTDEE(s, logs, date).phase, "cut");
});
test("calibration uses actual complete intake, morning-to-morning alignment and normalized movement", () => {
  const result = estimateTDEE(series(), estimateOptions);
  assert.equal(result.tdee, 2400);
  assert.equal(result.avgIntake, 2000);
  assert.equal(result.normalizedIntake, 1800);
  const logs = series();
  logs.at(-1).meals = [{ cals: 99999 }];
  logs.at(-1).foodComplete = false;
  assert.equal(estimateTDEE(logs, estimateOptions).tdee, 2400);
});
test("unknown food, missing dates and unfinished steps block calibration rather than inventing data", () => {
  for (const change of [
    (logs) => logs.splice(25, 1),
    (logs) => {
      logs[25].foodComplete = false;
    },
    (logs) => {
      delete logs[25].foodComplete;
    },
    (logs) => {
      logs[25].activityComplete = false;
    },
    (logs) => {
      logs[25].meals = [{ cals: -1 }];
    },
  ]) {
    const logs = series();
    change(logs);
    assert.equal(estimateTDEE(logs, estimateOptions), null);
  }
});
test("one bad scale reading is excluded from calibration without deleting the recorded fact", () => {
  const logs = series(),
    original = logs[25].weight;
  logs[25].weight += 8;
  const result = estimateTDEE(logs, estimateOptions);
  assert.equal(result.tdee, 2400);
  assert.equal(result.discardedWeights, 1);
  assert.equal(logs[25].weight, original + 8);
});
test("a very noisy weight window does not produce a confident TDEE adjustment", () => {
  const logs = series().map((l, i) => ({
    ...l,
    weight: l.weight + (i % 2 ? 1.5 : -1.5),
  }));
  assert.equal(estimateTDEE(logs, estimateOptions), null);
});
test("known zero intake is actual data and no saved fasting prescription substitutes calories", () => {
  const logs = series();
  logs[25].meals = [];
  logs[25].fasting = true;
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
test("calibration begins after 28 days and each accepted weekly correction is bounded", () => {
  const logs = series(43),
    s = { ...setup, startDate: logs[0].date };
  assert.equal(getAdaptiveTDEE(s, logs, logs[21].date).isDataDriven, false);
  const first = getAdaptiveTDEE(s, logs, logs[28].date);
  const formula = Math.round(Math.round(restingEnergy(s, first.curW)) * 1.45);
  assert.equal(first.isDataDriven, true);
  assert.ok(Math.abs(first.base - formula) <= 101);
});
test("incomplete later logs hold a learned estimate instead of reverting to the formula", () => {
  const logs = series(43),
    s = { ...setup, startDate: logs[0].date };
  logs[30].foodComplete = false;
  const result = getAdaptiveTDEE(s, logs, logs[35].date);
  assert.equal(result.isDataDriven, true);
  assert.equal(result.calibration.lastAcceptedReview, logs[28].date);
  assert.equal(result.calibration.status, "needs_data");
  assert.ok(
    result.base < Math.round(restingEnergy(s, result.curW) * 1.45) - 80,
  );
});
test("repeated reliable weeks can correct a large initial formula error gradually", () => {
  const logs = Array.from({ length: 113 }, (_, i) =>
    full({
      date: shiftDay("2026-01-01", i),
      weight: 85,
      steps: 10000,
      meals: [{ cals: 1900 }],
    }),
  );
  const s = { ...setup, startDate: logs[0].date, cutLength: 60 };
  const result = getAdaptiveTDEE(s, logs, logs.at(-1).date);
  assert.ok(result.base >= 1850 && result.base < 1950);
  assert.equal(result.isDataDriven, true);
});
test("a changed baseline restarts calibration instead of reusing the previous activity regime", () => {
  const logs = series(43),
    s = { ...setup, startDate: logs[0].date, calibrationSince: logs[35].date };
  assert.equal(getAdaptiveTDEE(s, logs, logs.at(-1).date).isDataDriven, false);
});
test("a future maintenance latch cannot contaminate earlier learning", () => {
  const logs = series(36),
    s = {
      ...setup,
      startDate: logs[0].date,
      maintenanceSince: shiftDay(logs.at(-1).date, 7),
    };
  const result = getAdaptiveTDEE(s, logs, logs[21].date);
  assert.equal(result.phase, "cut");
  assert.equal(result.estimate, null);
});
test("step compensation counts movement in the allowance once and respects the movement ceiling", () => {
  const old = shiftDay(date, -1),
    logs = [
      full({
        date: old,
        steps: 15000,
        meals: [{ cals: 2400 }],
        planSnapshot: { source: "captured", eatTarget: 2200 },
      }),
      day(),
    ];
  const result = getDynamicStepGoal(
    { ...setup, startDate: old },
    logs,
    null,
    logs[1],
  );
  assert.equal(result.outstandingKcal, 200);
  assert.equal(result.capped, true);
});
test("partial or missing food cannot clear compensation from earlier completed days", () => {
  const old = shiftDay(date, -2),
    logs = [
      full({
        date: old,
        meals: [{ cals: 2300 }],
        planSnapshot: { source: "captured", eatTarget: 2000 },
      }),
      day({ date: shiftDay(date, -1) }),
      day({ meals: [{ cals: 500 }] }),
    ];
  assert.equal(
    getDynamicStepGoal({ ...setup, startDate: old }, logs, null, logs[2])
      .outstandingKcal,
    300,
  );
});
test("consecutive strength weeks sort numerically and missing BF cannot invent composition", () => {
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
    inferBodyComp({
      logs: series(),
      anchor: { weight: 85, bf: null, date: "2026-01-01" },
    }),
    null,
  );
});
test("flat weight at the scale goal is reached rather than stalled", () => {
  const logs = series().map((l) => ({ ...l, weight: 79 }));
  assert.equal(
    projectGoal({
      logs,
      currentWeight: 79,
      currentBF: 15,
      goalBF: 12,
      leanMass: 67,
      targetWeight: 79,
    }).reached,
    true,
  );
});
test("restoration preserves original-only fields, newer facts and past prescriptions", () => {
  const classic = { name: "Original", startBF: 20 };
  assert.equal(restoredSetup(classic, { profile: { name: "New" } }), classic);
  const rows = [
    {
      key: `log:${date}`,
      updated_at: "2026-01-01",
      value: day({ sleep: 8, steps: 8000, planSnapshot: { eatTarget: 1900 } }),
    },
  ];
  const newer = {
    updated_at: "2026-01-02",
    value: { logs: [day({ steps: 15000, meals: [{ cals: 2200 }] })] },
  };
  const [log] = restoredLogs(rows, newer);
  assert.equal(log.sleep, 8);
  assert.equal(log.steps, 15000);
  assert.equal(log.planSnapshot, null);
  rows[0].value.planSnapshot = { modelVersion: 4, eatTarget: 1900 };
  assert.equal(restoredLogs(rows, newer)[0].steps, 8000);
});
test("a v2-only account retains its scale goal without a fabricated BF reading", () => {
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
test("an idealized closed-loop simulation corrects an overestimated TDEE and continues past a missed deadline", () => {
  const s = {
    ...setup,
    startDate: "2026-01-01",
    cutLength: 42,
    manualCalTarget: "",
  };
  const logs = [];
  let weight = 85,
    reached = false;
  for (let i = 0; i < 180; i++) {
    const d = shiftDay(s.startDate, i),
      steps = 10000 + (i % 4) * 1000;
    const log = day({
      date: d,
      weight: weight + Math.sin(i * 0.7) * 0.12,
      steps,
      foodComplete: false,
      activityComplete: false,
    });
    const result = getPlanForDate({ date: d, log, setup: s, logs });
    assert.ok(result.eatTarget >= 1500);
    assert.equal(result.deficit, result.maintenance - result.eatTarget);
    log.meals = [{ cals: result.eatTarget }];
    log.foodComplete = true;
    log.activityComplete = true;
    logs.push(log);
    const model = getAdaptiveTDEE(s, logs, d);
    if (i === 43) {
      assert.equal(model.phase, "cut");
      assert.equal(model.deadlineMissed, true);
    }
    if (model.phase === "maintenance") {
      reached = true;
      assert.ok(i > 42);
      assert.equal(model.target, model.base);
      break;
    }
    const actualTDEE = 2200 - (85 - weight) * 20 + (steps - 10000) * 0.04;
    weight += (result.eatTarget - actualTDEE) / 7700;
  }
  assert.equal(
    reached,
    true,
    "Under stated simulated assumptions, feedback must eventually reach the goal",
  );
});
