import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { MODEL_VERSION, today, shiftDay } from "../src/lib/planEngine.js";

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
const sunday=shiftDay(date,-new Date(`${date}T12:00:00`).getDay());
const priorSunday=shiftDay(sunday,-7);
const oldSunday=seed.find(([key])=>key===`log:${priorSunday}`)?.[1];
if(oldSunday)oldSunday.measurements={waistIn:34};
if(sunday!==date){
  const index=seed.findIndex(([key])=>key===`log:${sunday}`);
  if(index>=0)seed.splice(index,1);
}
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
  const weightInput = page.getByLabel("Weight", { exact: true });
  await weightInput.fill("");
  assert.equal(await weightInput.inputValue(), "");
  await weightInput.pressSequentially("82.", { delay: 60 });
  await page.waitForTimeout(650);
  assert.equal(await weightInput.inputValue(), "82.");
  assert.equal((await stored(`log:${date}`)).weight, 85);
  await weightInput.pressSequentially("75", { delay: 60 });
  await weightInput.press("Enter");
  await page.waitForFunction(({key,date})=>new Map(JSON.parse(localStorage.getItem(key))).get(`log:${date}`)?.weight===82.75,{key,date});
  await weightInput.fill("83.25");
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForFunction(({key,date})=>new Map(JSON.parse(localStorage.getItem(key))).get(`log:${date}`)?.weight===83.25,{key,date});
  await weightInput.fill("85");
  await weightInput.press("Tab");
  await page.waitForFunction(({key,date})=>new Map(JSON.parse(localStorage.getItem(key))).get(`log:${date}`)?.weight===85,{key,date});
  console.log("PASS decimal weight typing, clearing, trailing decimal, Enter and blur saves");
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
  assert.equal(await page.getByRole('checkbox', { name: /whole day|final for this day/ }).count(), 0);
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
    "PASS 40 kcal credit, food entry without completion switches and reload persistence",
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
  assert.equal((await stored("setup")).manualCalTarget, null);
  await page.waitForFunction(({ key, date }) => {
    const snapshot = new Map(JSON.parse(localStorage.getItem(key))).get(`log:${date}`).planSnapshot;
    return snapshot.isManual === false && snapshot.stepCredit === 200 && snapshot.eatTarget === snapshot.target + 200;
  }, { key, date });
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
  await page.getByRole('heading', { name: 'Consistency', exact: true }).waitFor();
  assert.equal(await page.getByText("Weekly Review", { exact: true }).count(), 0);
  await page.getByText("Sunday body measurements", { exact: true }).waitFor();
  await page.getByText("Progress Photos", { exact: true }).waitFor();
  await page.getByLabel(/^Waist/).fill("33");
  await page.waitForFunction(({key,sunday})=>new Map(JSON.parse(localStorage.getItem(key))).get(`log:${sunday}`)?.measurements?.waistIn===33,{key,sunday});
  if(sunday!==date){
    const measured=await stored(`log:${sunday}`);
    assert.equal(measured.weight,null);
    assert.equal(measured.steps,null);
    assert.deepEqual(measured.meals,[]);
    assert.equal(measured.foodComplete,false);
    assert.equal((await stored(`log:${priorSunday}`)).measurements.waistIn,34);
  }
  await nav("Today");
  assert.equal(await page.getByLabel("Steps",{exact:true}).inputValue(),"15000");
  assert.equal(await page.getByLabel("Weight",{exact:true}).inputValue(),"85");
  console.log("PASS Sunday measurements cannot fabricate old food/weight/steps or replace the day open in Today");
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
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  const downloading=page.waitForEvent("download");
  await page.getByRole("button",{name:/Full backup \(JSON\)/}).click();
  const download=await downloading,stream=await download.createReadStream(),chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  const backup=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.equal(backup.diagnostics.modelVersion,MODEL_VERSION);
  assert.equal(backup.diagnostics.asOfDate,date);
  assert.equal(backup.diagnostics.goalWeight,78.5);
  assert.equal(backup.diagnostics.phase,"cut");
  assert.equal(backup.diagnostics.stepCredit,200);
  assert.equal(backup.diagnostics.plannedDeficit,backup.diagnostics.baselineTDEE+200-backup.diagnostics.eatTarget);
  assert.equal(backup.logs.find(log=>log.date===date).steps,15000);
  await page.getByRole("button",{name:"Cancel",exact:true}).click();
  console.log("PASS full backup includes the exact displayed model inputs, outputs, version and local date for replay");

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
  await bridgePage.getByRole("button", {name:/Moderate/}).click();
  await bridgePage.getByRole("button", {name:"Save Changes",exact:true}).click();
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

  // Reproduce the reported Nov 20 screen, then advance the same account to its first review.
  const learningContext = await browser.newContext({ timezoneId:'Asia/Kolkata', serviceWorkers:'block' });
  const learningPage = await learningContext.newPage();
  learningPage.on('pageerror', error => errors.push(error.message));
  const learningStart = '2026-11-11';
  const learningRows = Array.from({ length:14 }, (_, i) => {
    const d = shiftDay(learningStart, i);
    return [`log:${d}`, { date:d, weight:i === 9 ? null : 85 - i * .05, steps:10000, meals:[{ name:'Daily total', cals:2000 }] }];
  });
  const learningSeed = [['setup', { ...setup, startDate:learningStart }], ...learningRows.slice(0,10)];
  await learningPage.addInitScript(({ key, seed }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(seed));
  }, { key, seed:learningSeed });
  await learningPage.clock.setFixedTime(new Date('2026-11-20T06:30:00Z'));
  await learningPage.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  const openLearning = () => learningPage.getByRole('button', { name:'Cut IQ', exact:true }).first().click();
  await openLearning();
  await learningPage.getByText('Logged this cut: 10 days · Food: 10 · Steps: 10 · Weigh-ins: 9', { exact:true }).waitFor();
  await learningPage.getByText(/Learning progress: 10 of 14 logged days.*24 Nov/).waitFor();
  assert.doesNotMatch(await learningPage.locator('body').innerText(), /not enough recent weigh-ins|four weeks|25 Nov/i);
  await learningPage.evaluate(({ key, extra }) => {
    const rows = new Map(JSON.parse(localStorage.getItem(key)));
    for (const [k, value] of extra) rows.set(k, value);
    localStorage.setItem(key, JSON.stringify([...rows]));
  }, { key, extra:learningRows.slice(10) });
  await learningPage.clock.setFixedTime(new Date('2026-11-24T06:30:00Z'));
  await learningPage.reload();
  await openLearning();
  await learningPage.getByText('Logged this cut: 14 days · Food: 14 · Steps: 14 · Weigh-ins: 13', { exact:true }).waitFor();
  await learningPage.getByText(/First review: 24 Nov\. Last accepted estimate: 24 Nov/).waitFor();
  await learningPage.getByText('Observed estimate', { exact:true }).waitFor();
  await learningContext.close();
  console.log('PASS ten saved dates count under a manual target and the first maintenance estimate appears on day fourteen');

  // A fully logged plateau must learn without any old completion switches.
  // The issued baseline is 2,397. Consistently eating 1,900 holds that baseline; 5,000 extra steps add 200.
  const learnedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const learnedSeed = [
    ['setup', { ...setup, startDate: shiftDay(date, -112), cutLength: 180, manualCalTarget: null }],
    ...Array.from({ length: 113 }, (_, i) => {
      const day = shiftDay(date, i - 112);
      return [`log:${day}`, { date: day, weight: 85, steps: 10000, sleep: 8, meals: [{ name: 'Daily total', cals: 1900 }], foodComplete: false, activityComplete: false }];
    }),
  ];
  await learnedContext.addInitScript(({ key, seed }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(seed));
  }, { key, seed: learnedSeed });
  const learnedPage = await learnedContext.newPage();
  learnedPage.on('pageerror', error => errors.push(error.message));
  const learnedNav = name => learnedPage.getByRole('button', { name, exact: true }).first().click();
  await learnedPage.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  await learnedPage.getByText('of 2397 kcal', { exact: true }).waitFor();
  await learnedPage.getByLabel('Steps', { exact: true }).fill('15000');
  await learnedPage.getByText('of 2597 kcal', { exact: true }).waitFor();
  await learnedPage.waitForFunction(({ key, date }) => new Map(JSON.parse(localStorage.getItem(key))).get(`log:${date}`).steps === 15000, { key, date });
  await learnedPage.reload();
  await learnedPage.getByText('of 2597 kcal', { exact: true }).waitFor();
  await learnedNav('Nutrition');
  await learnedPage.getByText('Target · kcal', { exact: true }).locator('..').getByText('2597', { exact: true }).waitFor();
  await learnedNav('Cut IQ');
  await learnedPage.getByText('CALIBRATED ESTIMATE', { exact: true }).waitFor();
  await learnedPage.getByText('2597 kcal', { exact: true }).waitFor();
  await learnedPage.getByText('Observed estimate', { exact: true }).locator('..').getByText('1900', { exact: true }).waitFor();
  assert.ok(await learnedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await learnedPage.screenshot({ path: 'artifacts/adaptive-390.png', fullPage: true });

  const missingDate = shiftDay(date, -5);
  await learnedPage.evaluate(({ key, missingDate }) => {
    const records = new Map(JSON.parse(localStorage.getItem(key)));
    records.get(`log:${missingDate}`).meals = [];
    localStorage.setItem(key, JSON.stringify([...records]));
  }, { key, missingDate });
  await learnedPage.reload();
  await learnedNav('Cut IQ');
  await learnedPage.getByText(`Missing food on ${missingDate}.`, { exact: false }).waitFor();
  await learnedPage.getByText('CALIBRATED ESTIMATE', { exact: true }).waitFor();
  await learnedPage.getByText('2597 kcal', { exact: true }).waitFor();
  await learnedContext.close();
  console.log('PASS plateau calibration, baseline hold, step credit, cross-tab agreement, reload and an isolated missing day');
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
