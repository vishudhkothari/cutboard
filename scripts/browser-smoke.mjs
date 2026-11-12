import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { addDays, today } from "../src/lib/cutEngine.js";

// Run against a VITE_DEMO=1 dev server. Uses an isolated browser context;
// never reads or writes the user's actual account or browser profile.
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const url = process.env.TEST_URL || "http://127.0.0.1:5173";
await mkdir("artifacts", { recursive: true });
try {
  await page.goto(url);
  await page.getByLabel("Name", { exact: true }).fill("Test");
  await page.getByLabel("Age", { exact: true }).fill("30");
  await page.getByLabel("Height · cm").fill("180");
  await page.getByLabel("Start weight · kg").fill("85");
  await page.getByLabel("Goal weight · kg").fill("79");
  await page.getByLabel("Goal date").fill(addDays(today(), 77));
  await page.getByText("I already know my maintenance calories").click();
  await page.getByLabel("Baseline maintenance · optional").fill("2600");
  await page.getByRole("button", { name: "Save my plan" }).click();
  await page.getByRole("heading", { name: "Today", exact: true }).waitFor();
  assert.match(await page.locator(".big-number").innerText(), /2,000/);
  await page.getByLabel("Steps so far").fill("15000");
  assert.match(await page.locator(".big-number").innerText(), /2,158/);
  await page.getByLabel("Morning weight · kg").fill("85");
  await page.getByRole("button", { name: "Add meal", exact: true }).click();
  await page.getByLabel("Meal name", { exact: true }).fill("Lunch");
  await page.getByLabel("Calories", { exact: true }).fill("500");
  await page.getByLabel("Protein · g", { exact: true }).fill("25");
  await page.getByRole("button", { name: "+ Add food", exact: true }).click();
  await page.getByText("Food log includes the whole day").check();
  await page.getByText("Step count is final for this day.").check();
  await page.getByRole("button", { name: "Save day", exact: true }).click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("cutiq:v2:demo"))?.logs[0]?.foodComplete,
  );
  await page.reload();
  await page.getByText("Lunch", { exact: true }).waitFor();
  assert.match(await page.locator(".big-number").innerText(), /2,158/);
  await page.screenshot({
    path: "artifacts/today-desktop.png",
    fullPage: true,
  });
  console.log(
    "PASS onboarding, exact energy balance, meal logging and reload persistence",
  );

  await page.getByLabel("Steps so far").fill("16000");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  assert.equal(await page.getByLabel("Steps so far").inputValue(), "16000");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await page.getByRole("heading", { name: "Weight over time." }).waitFor();
  await page.screenshot({
    path: "artifacts/progress-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Today", exact: true }).click();
  assert.equal(await page.getByLabel("Steps so far").inputValue(), "15000");
  console.log("PASS unsaved-change protection and trend view");

  // Editing to a final low-step day reduces the food allowance, not the deficit.
  await page.getByLabel("Steps so far").fill("5000");
  assert.match(await page.locator(".big-number").innerText(), /1,842/);
  await page.getByRole("button", { name: "Save day", exact: true }).click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("cutiq:v2:demo"))?.logs[0]?.steps ===
      5000,
  );
  const second = await context.newPage();
  await second.goto(url);
  await second.getByLabel("Steps so far").waitFor();
  await page.getByLabel("Steps so far").fill("10000");
  await page.getByRole("button", { name: "Save day", exact: true }).click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("cutiq:v2:demo"))?.logs[0]?.steps ===
      10000,
  );
  await second.getByLabel("Steps so far").fill("12000");
  await second.getByRole("button", { name: "Save day", exact: true }).click();
  await second
    .getByRole("alert")
    .filter({ hasText: "another tab or device" })
    .waitFor();
  assert.equal(await second.getByLabel("Steps so far").inputValue(), "12000");
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("cutiq:v2:demo")).logs[0].steps,
    ),
    10000,
  );
  const draftDownload = second.waitForEvent("download");
  await second.getByRole("button", { name: "Export data" }).click();
  const draftBackup = JSON.parse(
    await readFile(await (await draftDownload).path(), "utf8"),
  );
  assert.equal(draftBackup.logs[0].steps, 12000);
  await second.close();
  console.log(
    "PASS low-activity adjustment and conflict protection without losing the draft",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/today-mobile.png", fullPage: true });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile content must not overflow horizontally",
  );
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await page.screenshot({
    path: "artifacts/progress-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByText("Evidence and model limits").click();
  await page.screenshot({ path: "artifacts/plan-mobile.png", fullPage: true });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByRole("button", { name: "Start maintenance today" }).click();
  await page.locator(".phase.maintenance").waitFor();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  assert.match(await page.locator(".big-number").innerText(), /2,600/);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export data" }).click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().startsWith("cutiq-"));
  await page.reload();
  await page.locator(".phase.maintenance").waitFor();
  assert.match(await page.locator(".big-number").innerText(), /2,600/);
  assert.equal(
    await page.getByRole("button", { name: /workout|fasting/i }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS mobile layout, maintenance persistence, backup export, and no runtime errors",
  );

  // A goal-reaching draft and its header must use exactly the same live plan.
  const goalContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await goalContext.addInitScript(
    ({ start, goal, previous }) => {
      if (!localStorage.getItem("cutiq:v2:demo"))
        localStorage.setItem(
          "cutiq:v2:demo",
          JSON.stringify({
            version: 2,
            profile: {
              name: "Goal",
              age: 30,
              height: 180,
              sex: "male",
              startWeight: 85,
              goalWeight: 79,
              startDate: start,
              goalDate: goal,
              baselineSteps: 10000,
              gymDays: 5,
              gymMinutes: 60,
              maintenanceOverride: 2600,
            },
            logs: previous.map((date, i) => ({
              date,
              weight: 78.8 + i * 0.1,
              steps: null,
              meals: [],
              foodComplete: false,
              activityComplete: false,
              trained: false,
              notes: "",
            })),
          }),
        );
    },
    {
      start: addDays(today(), -14),
      goal: addDays(today(), 63),
      previous: [addDays(today(), -2), addDays(today(), -1)],
    },
  );
  const goalPage = await goalContext.newPage();
  await goalPage.goto(url);
  await goalPage.locator(".phase.cut").waitFor();
  await goalPage.getByLabel("Morning weight · kg").fill("79");
  await goalPage.locator(".phase.maintenance").waitFor();
  await goalPage.getByText("MAINTENANCE ALLOWANCE", { exact: true }).waitFor();
  assert.equal(
    await goalPage.evaluate(
      () =>
        JSON.parse(localStorage.getItem("cutiq:v2:demo")).profile
          .maintenanceSince,
    ),
    undefined,
  );
  await goalPage.getByRole("button", { name: "Save day", exact: true }).click();
  await goalPage.waitForFunction(
    () =>
      !!JSON.parse(localStorage.getItem("cutiq:v2:demo")).profile
        .maintenanceSince,
  );
  await goalPage.reload();
  await goalPage.locator(".phase.maintenance").waitFor();
  await goalContext.close();
  console.log(
    "PASS goal-reaching draft, shared phase display, saved maintenance latch and draft backup",
  );
} finally {
  await browser.close();
}
