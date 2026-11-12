import { chromium } from "playwright";
import assert from "node:assert/strict";
import { today, shiftDay } from "../src/lib/planEngine.js";

// Production code with intercepted fixture auth/storage. No external HTTP escapes.
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
});
const context = await browser.newContext({ serviceWorkers: "block" });
const date = today();
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "test@example.com",
  aud: "authenticated",
  role: "authenticated",
};
const row = (key, value, updated_at = "2026-01-01T00:00:00Z") => ({
  user_id: user.id,
  key,
  value,
  updated_at,
});
let rows = [
  row("setup", {
    name: "Original",
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
    manualCalTarget: 2000,
  }),
  row(`log:${date}`, {
    date,
    weight: 85,
    steps: 10000,
    sleep: 8,
    meals: [{ name: "Legacy lunch", cals: 500, protein: 25 }],
  }),
  row("recipes", [
    {
      id: "dal",
      name: "Saved Dal",
      items: [],
      perServing: { cals: 500, protein: 20, carbs: 70, fat: 10, fiber: 8 },
    },
  ]),
  row("workout_history", []),
  row(
    "cutiq:v2",
    {
      version: 2,
      profile: null,
      logs: [
        {
          date,
          weight: 85,
          steps: 12000,
          meals: [{ name: "Newer lunch", cals: 600, protein: 30 }],
        },
      ],
    },
    "2026-01-02T00:00:00Z",
  ),
];
const preserved = structuredClone(
  rows.filter((r) =>
    ["recipes", "workout_history", "cutiq:v2"].includes(r.key),
  ),
);
let writes = 0,
  rejectSave = false,
  rejectRead = false;
const token = [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  Buffer.from(
    JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url"),
  "signature",
].join(".");
await context.route("**/*", async (route) => {
  const req = route.request(),
    u = new URL(req.url());
  if (["127.0.0.1", "localhost"].includes(u.hostname)) return route.continue();
  const reply = (status, body) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(body),
    });
  if (req.method() === "OPTIONS") return reply(200, {});
  if (u.pathname.endsWith("/auth/v1/token"))
    return reply(200, {
      access_token: token,
      refresh_token: "fixture",
      expires_in: 3600,
      token_type: "bearer",
      user,
    });
  if (u.pathname.endsWith("/auth/v1/user")) return reply(200, user);
  if (u.pathname.endsWith("/auth/v1/logout")) return reply(200, {});
  if (u.pathname.endsWith("/rest/v1/shared_foods")) return reply(200, []);
  if (u.pathname.endsWith("/rest/v1/user_data")) {
    const method = req.method();
    if (method === "GET" && rejectRead)
      return reply(503, { message: "Simulated load failure" });
    const matches = (r) =>
      [...u.searchParams].every(([key, value]) => {
        if (value.startsWith("eq.")) return String(r[key]) === value.slice(3);
        if (value.startsWith("like."))
          return r[key]?.startsWith(value.slice(5, -1));
        return true;
      });
    if (method === "GET") {
      assert.equal(u.searchParams.get("user_id"), `eq.${user.id}`);
      const matched = rows.filter(matches);
      return reply(
        200,
        req.headers().accept?.includes("vnd.pgrst.object")
          ? (matched[0] ?? null)
          : matched,
      );
    }
    writes++;
    if (rejectSave) return reply(503, { message: "Simulated save failure" });
    const body = req.postDataJSON();
    if (method === "POST") {
      assert.equal(body.user_id, user.id);
      assert.ok(body.key.startsWith("log:"));
      rows.push(body);
      return reply(201, null);
    }
    if (method === "PATCH") {
      assert.equal(u.searchParams.get("user_id"), `eq.${user.id}`);
      assert.ok(u.searchParams.has("updated_at"));
      const matched = rows.filter(matches);
      matched.forEach((r) => Object.assign(r, body));
      return reply(200, matched[0] ? { key: matched[0].key } : null);
    }
    throw new Error(`Unexpected destructive request: ${method}`);
  }
  return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const savedSteps = async (steps) => {
  for (let i = 0; i < 100; i++) {
    if (rows.find((r) => r.key === `log:${date}`)?.value.steps === steps)
      return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Steps ${steps} not saved`);
};
try {
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:5174");
  await page.getByPlaceholder("you@email.com").fill(user.email);
  await page.locator('input[type="password"]').fill("test-password");
  await page
    .getByRole("button", { name: "Sign In", exact: true })
    .last()
    .click();
  await page.getByText("of 2080 kcal", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Sleep", { exact: true }).inputValue(),
    "8",
  );
  assert.equal(writes, 0, "Loading existing data must not rewrite it");
  console.log(
    "PASS production auth and read-only bridge preserving classic and newer facts",
  );
  await page.getByLabel("Steps", { exact: true }).fill("15000");
  await page.getByText("of 2200 kcal", { exact: true }).waitFor();
  await savedSteps(15000);
  await page.reload();
  await page.getByText("of 2200 kcal", { exact: true }).waitFor();
  assert.deepEqual(
    rows.filter((r) =>
      ["recipes", "workout_history", "cutiq:v2"].includes(r.key),
    ),
    preserved,
  );
  console.log(
    "PASS scoped per-day save, reload, original recipes/workouts and v2 archive preservation",
  );
  rejectSave = true;
  await page.getByLabel("Steps", { exact: true }).fill("16000");
  await page
    .getByRole("alert")
    .filter({ hasText: "could not be saved" })
    .waitFor();
  assert.equal(
    await page.getByLabel("Steps", { exact: true }).inputValue(),
    "16000",
  );
  assert.equal(rows.find((r) => r.key === `log:${date}`).value.steps, 15000);
  rejectSave = false;
  await page.getByRole("button", { name: "Retry saves", exact: true }).click();
  await savedSteps(16000);
  console.log("PASS failed saves retain edits and retry successfully");
  rejectRead = true;
  await page.reload();
  await page
    .getByRole("alert")
    .filter({ hasText: "Simulated load failure" })
    .waitFor();
  assert.equal(
    await page.getByText("Setup Your Profile", { exact: true }).count(),
    0,
  );
  rejectRead = false;
  await page
    .getByRole("button", { name: "Retry loading", exact: true })
    .click();
  await page.getByText("of 2240 kcal", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS read errors stay visible, never become an empty account, and recover on retry",
  );
  await page.getByLabel("Steps", { exact: true }).fill("16500");
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await page.getByPlaceholder("you@email.com").waitFor();
  assert.equal(
    rows.find((row) => row.key === `log:${date}`).value.steps,
    16500,
  );
  console.log(
    "PASS signing out flushes the last debounced edit before ending the session",
  );
} catch (error) {
  console.log((await page.locator("body").innerText()).slice(-3000));
  throw error;
} finally {
  await browser.close();
}
