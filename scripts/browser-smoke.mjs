import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { today, shiftDay } from "../src/lib/planEngine.js";

// Isolated demo account: never visits the user's browser profile or cloud data.
const date = today();
const key = "cutboard:demo:v3";
const setup = {
  name: "Test",
  age: 30,
  height: 180,
  sex: "male",
  activity: "mod",
  startWeight: 85,
  startBF: 20,
  goalBF: 12,
  goalWeight: 79,
  startDate: shiftDay(date, -15),
  cutLength: 77,
  stepGoal: 10000,
  userMaxStepBudget: 14000,
  manualCalTarget: 2000,
  activeCut: false,
  cardioMin: 35,
};
const seed = [
  ["setup", setup],
  ["recipes", []],
  ["plan_settings", { fastCompensation: false }],
  ["zigzag_settings", { on: true, schedule: 1, mode: "extreme" }],
  [
    "routines",
    [
      {
        id: "push",
        name: "Push Day",
        exercises: [
          {
            exerciseId: "bench_press",
            name: "Bench Press",
            cat: "Chest",
            sets: 1,
            repsTarget: 8,
            restSeconds: 90,
          },
        ],
      },
    ],
  ],
  ["workout_history", []],
  ...Array.from({ length: 16 }, (_, i) => {
    const d = shiftDay(date, i - 15);
    return [
      `log:${d}`,
      {
        date: d,
        weight: 85,
        steps: 10000,
        sleep: 7.5,
        meals: [
          {
            name: "Original lunch",
            cals: 500,
            protein: 25,
            carbs: 50,
            fat: 20,
            fiber: 5,
          },
        ],
      },
    ];
  }),
];
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  serviceWorkers: "block",
});
await context.addInitScript(
  ({ key, seed }) => {
    if (!localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify(seed));
  },
  { key, seed },
);
const page = await context.newPage();
const errors = [];
page.setDefaultTimeout(10000);
page.on("pageerror", (e) => errors.push(e.message));
const nav = (name) =>
  page.getByRole("button", { name, exact: true }).first().click();
const stored = async (name) =>
  page.evaluate(
    ({ key, name }) => new Map(JSON.parse(localStorage.getItem(key))).get(name),
    { key, name },
  );
const savedSteps = async (steps) =>
  page.waitForFunction(
    ({ key, date, steps }) =>
      new Map(JSON.parse(localStorage.getItem(key))).get(`log:${date}`)
        ?.steps === steps,
    { key, date, steps },
  );
await mkdir("artifacts", { recursive: true });
try {
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:5173");
  await page.getByText("of 2000 kcal", { exact: true }).waitFor();
  await page.getByLabel("Steps", { exact: true }).fill("15000");
  await page.getByText("of 2200 kcal", { exact: true }).waitFor();
  await savedSteps(15000);
  await page.getByRole("button", { name: "+ Add Meal", exact: true }).click();
  await page.getByLabel("Food / Meal", { exact: true }).fill("Test dinner");
  await page.getByLabel("Calories", { exact: true }).fill("700");
  await page.getByLabel("Protein (g)", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForFunction(
    ({ key, date }) =>
      new Map(JSON.parse(localStorage.getItem(key))).get(`log:${date}`)?.meals
        .length === 2,
    { key, date },
  );
  await page
    .getByText("Food log includes the whole day", { exact: true })
    .check();
  await page
    .getByText("Step count is final for this day", { exact: true })
    .check();
  await page.waitForFunction(
    ({ key, date }) =>
      new Map(JSON.parse(localStorage.getItem(key))).get(`log:${date}`)
        ?.foodComplete === true,
    { key, date },
  );
  await page.reload();
  await page.getByText("of 2200 kcal", { exact: true }).waitFor();
  assert.equal((await stored(`log:${date}`)).meals.length, 2);
  assert.equal(
    await page.getByRole("button", { name: "Schedule", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Fasting Day", exact: true })
      .count(),
    0,
  );
  console.log(
    "PASS 40 kcal credit, food entry, completion controls and reload persistence",
  );
  await nav("Cut IQ");
  await page.getByText("Calorie Strategy", { exact: true }).waitFor();
  await page.getByText("2200 kcal", { exact: true }).waitFor();
  await page.getByText("+200 kcal", { exact: true }).waitFor();
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /Active Cut|Fasting|Zigzag|Diet Regime/,
  );
  await page
    .getByRole("button", { name: "Use adaptive target", exact: true })
    .click();
  await page.getByText("FORMULA ESTIMATE", { exact: true }).waitFor();
  assert.equal((await stored("setup")).manualCalTarget, "");
  assert.equal((await stored(`log:${date}`)).steps, 15000);
  console.log(
    "PASS Schedule removed, live strategy moved to Cut IQ, fixed/manual override can return to adaptive",
  );

  await nav("Nutrition");
  await page
    .getByRole("button", { name: "+ Build a Meal", exact: true })
    .click();
  assert.ok(
    (await page.getByPlaceholder(/meal name|name your|e.g./i).count()) ||
      (await page.getByText("Build a Meal", { exact: false }).count()),
  );
  await page
    .getByRole("button", { name: /Cancel|Close/ })
    .last()
    .click();
  await nav("Progress");
  await page.getByText("Weekly Review", { exact: true }).waitFor();
  await page.getByText("Sunday body measurements", { exact: true }).waitFor();
  await page.getByText("Progress Photos", { exact: true }).waitFor();
  await nav("Cut IQ");
  await page.getByText("Weekly Strength Check-in", { exact: true }).waitFor();
  await page.getByRole("button", { name: /^Holding/ }).click();
  assert.equal((await stored("cut_intel")).strengthSignal, "same");
  console.log(
    "PASS nutrition, recipe builder, measurements, photos and strength check-in",
  );

  await nav("Workout");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.locator('input[type="number"]').nth(0).fill("80");
  await page.locator('input[type="number"]').nth(1).fill("8");
  await page.getByRole("button", { name: "\u2713", exact: true }).click();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page.getByText("Start a Workout", { exact: true }).waitFor();
  assert.equal(
    (await stored("workout_history"))[0].exercises[0].sets[0].weight,
    "80",
  );
  console.log("PASS workout routine, set logging and history persistence");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Target Scale Weight (kg)", { exact: true })
    .fill("78.5");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await page
    .getByRole("button", { name: "Today", exact: true })
    .first()
    .waitFor();
  assert.equal((await stored("setup")).goalWeight, 78.5);
  console.log("PASS profile edit and numeric scale-goal persistence");

  for (const viewport of [
    { width: 1440, height: 1100 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const tab of ["Today", "Nutrition", "Progress", "Cut IQ", "Workout"]) {
      await nav(tab);
      await page.waitForTimeout(150);
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /NaN|undefined|Infinity/,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${tab} overflows at ${viewport.width}px`,
      );
      await page.screenshot({
        path: `artifacts/restored-${tab.replace(" ", "-")}-${viewport.width}.png`,
        fullPage: true,
      });
    }
  }
  const bridgeContext = await browser.newContext({ serviceWorkers: "block" });
  const document = {
    version: 2,
    profile: {
      name: "Scale goal",
      age: 30,
      height: 180,
      sex: "male",
      startWeight: 85,
      goalWeight: 79,
      startDate: setup.startDate,
      goalDate: shiftDay(setup.startDate, 77),
      baselineSteps: 10000,
      gymDays: 5,
    },
    logs: seed
      .filter(([key]) => key.startsWith("log:"))
      .map(([, value]) => ({
        ...value,
        foodComplete: false,
        activityComplete: false,
      })),
  };
  await bridgeContext.addInitScript(
    (document) =>
      localStorage.setItem("cutiq:v2:demo", JSON.stringify(document)),
    document,
  );
  const bridgePage = await bridgeContext.newPage();
  bridgePage.on("pageerror", (error) => errors.push(error.message));
  await bridgePage.goto(process.env.TEST_URL || "http://127.0.0.1:5173");
  await bridgePage.getByLabel("Steps", { exact: true }).waitFor();
  for (const tab of ["Today", "Nutrition", "Progress", "Cut IQ", "Workout"]) {
    await bridgePage
      .getByRole("button", { name: tab, exact: true })
      .first()
      .click();
    assert.doesNotMatch(
      await bridgePage.locator("body").innerText(),
      /NaN|undefined|Infinity/,
    );
  }
  await bridgeContext.close();
  const overdueContext = await browser.newContext({ serviceWorkers: "block" });
  const overdueSeed = seed.map(([name, value]) => [
    name,
    name === "setup"
      ? {
          ...value,
          startDate: shiftDay(date, -90),
          cutLength: 60,
          manualCalTarget: "",
        }
      : value,
  ]);
  await overdueContext.addInitScript(
    ({ key, seed }) => localStorage.setItem(key, JSON.stringify(seed)),
    { key, seed: overdueSeed },
  );
  const overduePage = await overdueContext.newPage();
  overduePage.on("pageerror", (error) => errors.push(error.message));
  await overduePage.goto(process.env.TEST_URL || "http://127.0.0.1:5173");
  await overduePage
    .getByRole("button", { name: "Cut IQ", exact: true })
    .click();
  await overduePage
    .getByText("The deadline passed, but the goal is not confirmed.", {
      exact: false,
    })
    .waitFor();
  assert.doesNotMatch(
    await overduePage.locator("body").innerText(),
    /Goal confirmed|MAINTENANCE/,
  );
  await overdueContext.close();
  console.log(
    "PASS missed deadline keeps the cut active and displays a timeline review",
  );
  console.log(
    "PASS v2-only scale-goal restoration without a body-fat anchor across all five tabs",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS all five tabs on desktop/mobile, no runtime errors or horizontal overflow",
  );
} catch (error) {
  console.log((await page.locator("body").innerText()).slice(-4500));
  await page.screenshot({
    path: "artifacts/browser-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
