import test from "node:test";
import assert from "node:assert/strict";
import { migrateLegacy, validateState } from "./data.js";
test("migration preserves meals and measurements without importing competing prescriptions", () => {
  const rows = [
    {
      key: "setup",
      value: {
        name: "Test",
        age: 25,
        height: 180,
        startWeight: 85,
        startBF: 20,
        goalBF: 15,
        startDate: "2026-01-01",
        cutLength: 60,
        stepGoal: 10000,
        manualCalTarget: 1000,
        activeCut: true,
      },
    },
    {
      key: "log:2026-01-02",
      value: {
        date: "2026-01-02",
        weight: 84,
        steps: 13000,
        fasting: true,
        meals: [{ name: "Lunch", cals: 500, protein: 25 }],
        planSnapshot: { target: 999 },
      },
    },
    { key: "workout_history", value: [{ id: "untouched" }] },
  ];
  const before = structuredClone(rows);
  const result = migrateLegacy(rows);
  assert.deepEqual(rows, before);
  assert.equal(result.needsProfileReview, true);
  assert.equal(result.profile.goalWeight, 80);
  assert.equal(result.profile.goalDate, "2026-03-02");
  assert.equal(result.profile.manualCalTarget, undefined);
  assert.equal(result.logs[0].foodComplete, false);
  assert.equal(result.logs[0].activityComplete, false);
  assert.equal(result.logs[0].weight, 84);
  assert.deepEqual(result.logs[0].meals, before[1].value.meals);
  assert.equal(result.logs[0].planSnapshot, undefined);
  validateState(result);
});
test("malformed or unsupported backups are rejected without mutation", () => {
  assert.throws(() => validateState({ version: 1, logs: [] }));
  assert.throws(() =>
    validateState({
      version: 2,
      profile: null,
      logs: [{ date: "bad", meals: [] }],
    }),
  );
  assert.throws(() =>
    validateState({
      version: 2,
      profile: null,
      logs: [{ date: "2026-01-01", meals: [{ name: "Bad", cals: -2 }] }],
    }),
  );
});

test("duplicate dates, invalid completed steps and unknown meal energy are rejected", () => {
  const day = { date: "2026-01-01", meals: [] };
  const state = (logs) => ({ version: 2, profile: null, logs });
  assert.throws(() => validateState(state([day, { ...day }])));
  assert.throws(() =>
    validateState(state([{ ...day, steps: null, activityComplete: true }])),
  );
  assert.throws(() => validateState(state([{ ...day, steps: 100001 }])));
  assert.throws(() => validateState(state([{ ...day, foodComplete: "yes" }])));
  assert.throws(() =>
    validateState(
      state([{ ...day, meals: [{ name: "Unknown", cals: null }] }]),
    ),
  );
});
