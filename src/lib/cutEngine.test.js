import test from "node:test";
import assert from "node:assert/strict";
import {
  activityAdjustment,
  addDays,
  buildPlan,
  calibrate,
  cleanLogs,
  daysBetween,
  formulaMaintenance,
  intake,
  restingEnergy,
  stepEnergy,
  validDate,
  validateProfile,
  weightTrend,
} from "./cutEngine.js";

const profile = (overrides) => ({
  name: "Test",
  age: 30,
  height: 180,
  sex: "male",
  startWeight: 85,
  goalWeight: 79,
  startDate: "2026-01-01",
  goalDate: "2026-03-19",
  baselineSteps: 10000,
  gymDays: 5,
  gymMinutes: 60,
  maintenanceOverride: 2600,
  ...overrides,
});
const p = profile();
test("reference example: 2600 maintenance minus 600 deficit gives 2000 food", () => {
  const plan = buildPlan(p, [], p.startDate);
  assert.equal(plan.requestedDeficit, 600);
  assert.equal(plan.target, 2000);
  assert.equal(plan.deficit, 600);
});
test("extra steps add exactly the same calories to expenditure and food", () => {
  const base = buildPlan(p, [], p.startDate);
  const extra = buildPlan(
    p,
    [{ date: p.startDate, steps: 15000 }],
    p.startDate,
  );
  assert.equal(extra.activity, Math.round(5000 * stepEnergy(p, 85)));
  assert.equal(
    extra.target - base.target,
    extra.maintenance - base.maintenance,
  );
  assert.equal(extra.deficit, base.deficit);
});

test("an estimated 250 kcal activity increment yields 2250 food and the same 600 deficit", () => {
  const q = profile({ startWeight: 134.2, goalWeight: 128.2 });
  const plan = buildPlan(q, [{ date: q.startDate, steps: 15000 }], q.startDate);
  assert.equal(plan.activity, 250);
  assert.equal(plan.maintenance, 2850);
  assert.equal(plan.target, 2250);
  assert.equal(plan.deficit, 600);
});
test("baseline steps and gym check-in do not generate another credit", () => {
  const base = buildPlan(p, [], p.startDate);
  const trained = buildPlan(
    p,
    [{ date: p.startDate, steps: 10000, trained: true }],
    p.startDate,
  );
  assert.equal(trained.target, base.target);
  assert.equal(trained.activity, 0);
});
test("low partial steps do not penalize an unfinished day; final steps do", () => {
  const base = buildPlan(p, [], p.startDate);
  const partial = buildPlan(
    p,
    [{ date: p.startDate, steps: 5000 }],
    p.startDate,
  );
  const final = buildPlan(
    p,
    [{ date: p.startDate, steps: 5000, activityComplete: true }],
    p.startDate,
  );
  assert.equal(partial.target, base.target);
  assert.ok(final.target < base.target);
  assert.equal(final.deficit, base.deficit);
});
test("missing steps remain unknown; explicit zero is a real shortfall", () => {
  assert.equal(
    activityAdjustment(p, { steps: null, activityComplete: true }, 85),
    0,
  );
  assert.ok(
    activityAdjustment(p, { steps: 0, activityComplete: true }, 85) < 0,
  );
});
test("food minimum reduces the deficit and the displayed equation stays exact", () => {
  const plan = buildPlan(
    profile({ maintenanceOverride: 2100 }),
    [{ date: p.startDate, steps: 0, activityComplete: true }],
    p.startDate,
  );
  assert.equal(plan.target, 1500);
  assert.ok(plan.deficit < plan.plannedDeficit);
  assert.equal(plan.maintenance - plan.target, plan.deficit);
  assert.ok(plan.warnings.some((w) => w.includes("food minimum")));
});
test("impossible timelines are capped and remain visibly infeasible", () => {
  const plan = buildPlan(profile({ goalDate: "2026-01-03" }), [], p.startDate);
  assert.ok(plan.deficit <= 650);
  assert.ok(plan.requestedDeficit > plan.deficit);
  assert.ok(plan.projectedDate > "2026-01-03");
  assert.ok(plan.warnings.some((w) => w.includes("deadline")));
});
test("deadline alone never marks goal achieved or creates runaway deficit", () => {
  const plan = buildPlan(p, [], "2026-04-01");
  assert.equal(plan.phase, "cut");
  assert.ok(plan.deficit <= 650);
  assert.ok(plan.warnings.some((w) => w.includes("passed")));
});
test("goal needs a multi-weigh-in trend, not a single low measurement", () => {
  const logs = [{ date: "2026-01-09", weight: 78 }];
  assert.equal(buildPlan(p, logs, "2026-01-09").phase, "cut");
  logs.push(
    { date: "2026-01-10", weight: 78.5 },
    { date: "2026-01-11", weight: 79 },
  );
  const plan = buildPlan(p, logs, "2026-01-11");
  assert.equal(plan.phase, "maintenance");
  assert.equal(plan.deficit, 0);
  assert.equal(plan.target, plan.maintenance);
});
test("maintenance persists when the scale rebounds after goal achievement", () => {
  const logs = [8, 9, 10].map((i) => ({
    date: addDays(p.startDate, i),
    weight: 78.5,
  }));
  logs.push({ date: "2026-02-01", weight: 82 });
  assert.equal(buildPlan(p, logs, "2026-02-01").phase, "maintenance");
});
test("manual maintenance applies on its start date and not to earlier history", () => {
  const q = profile({ maintenanceSince: "2026-01-10" });
  assert.equal(buildPlan(q, [], "2026-01-09").phase, "cut");
  assert.equal(buildPlan(q, [], "2026-01-10").deficit, 0);
});
test("future logs cannot alter historical target, calibration or phase", () => {
  const base = buildPlan(p, [], p.startDate);
  const logs = [8, 9, 10].map((i) => ({
    date: addDays(p.startDate, i),
    weight: 78,
    meals: [{ cals: 9999 }],
  }));
  assert.deepEqual(buildPlan(p, logs, p.startDate), base);
});
test("baseline and deficit hold between weekly reviews", () => {
  const logs = [
    { date: "2026-01-02", weight: 84 },
    { date: "2026-01-03", weight: 83 },
  ];
  const a = buildPlan(p, logs, "2026-01-02"),
    b = buildPlan(p, logs, "2026-01-07");
  assert.equal(a.baselineMaintenance, b.baselineMaintenance);
  assert.equal(a.plannedDeficit, b.plannedDeficit);
  assert.equal(a.nextReview, "2026-01-08");
});
test("stale measurements never reset weight to the original start weight", () => {
  const plan = buildPlan(p, [{ date: "2026-01-08", weight: 82 }], "2026-02-01");
  assert.ok(plan.baselineMaintenance < 2600);
});
function calibrationLogs(extraSteps = 0) {
  return Array.from({ length: 36 }, (_, i) => ({
    date: addDays(p.startDate, i),
    weight: 85 - (600 / 7700) * i,
    steps: 10000 + extraSteps,
    foodComplete: true,
    activityComplete: true,
    meals: [{ cals: 2000 + extraSteps * stepEnergy(p, 85) }],
  }));
}
test("calibration waits out the first weeks and excludes initial water loss", () => {
  const logs = calibrationLogs();
  assert.equal(calibrate(p, logs, "2026-01-22", 85, 2600).source, "formula");
  const result = calibrate(p, logs, "2026-01-29", 85, 2600);
  assert.equal(result.source, "calibrated");
  assert.ok(Math.abs(result.measured - 2600) < 0.001);
  logs[0].weight = 95;
  assert.ok(
    Math.abs(calibrate(p, logs, "2026-01-29", 85, 2600).measured - 2600) <
      0.001,
  );
});
test("extra activity is normalized out before baseline calibration, avoiding double credit", () => {
  const a = calibrate(p, calibrationLogs(), "2026-01-29", 85, 2600);
  const b = calibrate(p, calibrationLogs(5000), "2026-01-29", 85, 2600);
  assert.ok(Math.abs(a.measured - b.measured) < 0.001);
});
test("one incomplete or missing day blocks calibration rather than inventing intake", () => {
  const logs = calibrationLogs();
  logs[15].foodComplete = false;
  assert.equal(calibrate(p, logs, "2026-01-29", 85, 2600).source, "formula");
  logs.splice(15, 1);
  assert.equal(calibrate(p, logs, "2026-01-29", 85, 2600).source, "formula");
});
test("calibration excludes food eaten after the last morning weigh-in", () => {
  const logs = calibrationLogs();
  const baseline = calibrate(p, logs, "2026-01-29", 85, 2600);
  logs[28].meals = [{ cals: 10000 }];
  assert.equal(
    calibrate(p, logs, "2026-01-29", 85, 2600).measured,
    baseline.measured,
  );
});
test("large energy-signal conflicts are rejected", () => {
  const logs = calibrationLogs().map((l) => ({
    ...l,
    meals: [{ cals: 6000 }],
  }));
  assert.equal(calibrate(p, logs, "2026-01-29", 85, 2600).source, "formula");
});
test("calendar calculations handle leap years and month boundaries", () => {
  assert.equal(addDays("2024-02-28", 2), "2024-03-01");
  assert.equal(daysBetween("2026-03-07", "2026-03-10"), 3);
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("nonsense"), false);
});
test("trend windows use calendar days and exclude null or future weights", () => {
  const trend = weightTrend(
    [
      { date: "2026-01-01", weight: 85 },
      { date: "2026-01-09", weight: 83 },
      { date: "2026-01-10", weight: null },
      { date: "2026-01-11", weight: 50 },
    ],
    "2026-01-10",
  );
  assert.equal(trend.at(-1).trend, 83);
  assert.equal(trend.at(-1).samples, 1);
});
test("duplicate dates are resolved deterministically without mutating inputs", () => {
  const logs = [
    { date: p.startDate, weight: 85 },
    { date: p.startDate, weight: 84 },
  ];
  assert.equal(cleanLogs(logs, p.startDate).length, 1);
  assert.equal(logs.length, 2);
  assert.equal(cleanLogs(logs, p.startDate)[0].weight, 84);
});
test("resting equation and baseline activity are separate components", () => {
  const q = profile({
    maintenanceOverride: "",
    baselineSteps: 3000,
    gymDays: 0,
  });
  assert.equal(restingEnergy(q, 85), 1830);
  assert.equal(formulaMaintenance(q, 85), 2196);
  assert.ok(formulaMaintenance({ ...q, gymDays: 5 }, 85) > 2196);
});
test("invalid adult profiles and underweight goals cannot silently produce targets", () => {
  assert.ok(validateProfile(profile({ age: 15 })).length);
  assert.ok(validateProfile(profile({ goalWeight: 40 })).length);
  assert.ok(validateProfile(profile({ goalDate: "bad" })).length);
  assert.throws(() => buildPlan(profile({ age: "" }), [], p.startDate));
});
test("blank food is unknown; explicit completed zero intake is represented as zero", () => {
  assert.equal(intake({ meals: [] }), 0);
  assert.equal(intake({ meals: [{ cals: 500 }, { cals: 200 }] }), 700);
});
test("macro guide remains within calorie allowance across a broad profile matrix", () => {
  for (const weight of [55, 85, 150, 290])
    for (const sex of ["male", "female"]) {
      const q = profile({
        startWeight: weight,
        goalWeight: weight - 5,
        height: 160,
        sex,
        maintenanceOverride: 1800,
      });
      const plan = buildPlan(q, [], q.startDate);
      assert.ok(
        plan.protein * 4 + plan.fat * 9 + plan.carbs * 4 <= plan.target + 2,
      );
      assert.equal(plan.maintenance - plan.target, plan.deficit);
    }
});

test("maintenance calibration holds out transition water regain", () => {
  const q = profile({ maintenanceSince: "2026-02-05" });
  const logs = Array.from({ length: 70 }, (_, i) => ({
    date: addDays(p.startDate, i),
    weight: i < 35 ? 85 - (i * 600) / 7700 : 84,
    steps: 10000,
    foodComplete: true,
    activityComplete: true,
    meals: [{ cals: i < 35 ? 2000 : 2600 }],
  }));
  const held = calibrate(q, logs, "2026-02-12", 85, 2600);
  assert.ok(held.reason.includes("water and glycogen"));
  assert.ok(Math.abs(held.measured - 2600) < 0.001);
  const refreshed = calibrate(q, logs, "2026-03-05", 85, 2600);
  assert.equal(refreshed.source, "calibrated");
  assert.ok(Math.abs(refreshed.measured - 2600) < 0.001);
});

test("a future cut still accounts for food eaten before its start date", () => {
  const q = profile({ startDate: "2026-01-10", goalDate: "2026-03-28" });
  const plan = buildPlan(
    q,
    [{ date: "2026-01-05", meals: [{ cals: 500 }] }],
    "2026-01-05",
  );
  assert.equal(plan.phase, "scheduled");
  assert.equal(plan.deficit, 0);
  assert.equal(plan.consumed, 500);
  assert.equal(plan.remaining, plan.target - 500);
});

test("changed baseline settings cannot relearn the previous activity regime", () => {
  const q = profile({ calibrationSince: "2026-01-25" });
  const logs = Array.from({ length: 70 }, (_, i) => ({
    date: addDays(p.startDate, i),
    weight: 85 - (600 / 7700) * i,
    steps: 10000,
    foodComplete: true,
    activityComplete: true,
    meals: [{ cals: 2000 }],
  }));
  assert.equal(calibrate(q, logs, "2026-02-05", 85, 2600).source, "formula");
  const resumed = calibrate(q, logs, "2026-02-26", 85, 2600);
  assert.equal(resumed.source, "calibrated");
  assert.ok(Math.abs(resumed.measured - 2600) < 0.001);
});

test("invalid step signals never create credits or qualify for calibration", () => {
  assert.equal(
    activityAdjustment(p, { steps: true, activityComplete: true }, 85),
    0,
  );
  assert.equal(
    activityAdjustment(p, { steps: 15000.5, activityComplete: true }, 85),
    0,
  );
  assert.equal(
    activityAdjustment(p, { steps: 100001, activityComplete: true }, 85),
    0,
  );
  const logs = calibrationLogs();
  logs[15].steps = 100001;
  assert.equal(calibrate(p, logs, "2026-01-29", 85, 2600).source, "formula");
});

test("invalid dates and fractional schedule counts do not produce prescriptions", () => {
  assert.throws(() => buildPlan(p, [], "2026-02-30"));
  assert.ok(validateProfile(profile({ gymDays: 5.5 })).length);
  assert.ok(validateProfile(profile({ baselineSteps: true })).length);
});
