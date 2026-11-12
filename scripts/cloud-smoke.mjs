import { chromium } from "playwright";
import assert from "node:assert/strict";
import { addDays, today } from "../src/lib/cutEngine.js";

// Run against a normal production preview. ALL external HTTP is intercepted;
// authentication and user_data are fixtures. No real account requests are sent.
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
});
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "test@example.com",
  aud: "authenticated",
  role: "authenticated",
};
const start = today();
let rows = [
  {
    key: "setup",
    value: {
      name: "Imported",
      age: 30,
      height: 180,
      sex: "male",
      startWeight: 85,
      goalWeight: 79,
      startDate: start,
      cutLength: 77,
      stepGoal: 10000,
      trainingDays: [1, 2, 3, 4, 5],
    },
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    key: `log:${start}`,
    value: {
      date: start,
      weight: 85,
      steps: 10000,
      meals: [{ name: "Legacy lunch", cals: 500, protein: 25 }],
    },
    updated_at: "2026-01-01T00:00:00Z",
  },
];
const original = structuredClone(rows);
let writes = 0,
  rejectSave = false;
const token = [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  Buffer.from(
    JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url"),
  "signature",
].join(".");
await page.route("**/*", async (route) => {
  const request = route.request(),
    u = new URL(request.url());
  if (["127.0.0.1", "localhost"].includes(u.hostname)) return route.continue();
  const reply = (status, body) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(body),
    });
  if (request.method() === "OPTIONS") return reply(200, {});
  if (u.pathname.endsWith("/auth/v1/token"))
    return reply(200, {
      access_token: token,
      refresh_token: "fake-refresh",
      expires_in: 3600,
      token_type: "bearer",
      user,
    });
  if (u.pathname.endsWith("/auth/v1/user")) return reply(200, user);
  if (u.pathname.endsWith("/rest/v1/user_data")) {
    if (request.method() === "GET") return reply(200, rows);
    writes++;
    if (rejectSave)
      return reply(503, { message: "Simulated unavailable backend" });
    const body = request.postDataJSON();
    assert.equal(body.key || "cutiq:v2", "cutiq:v2");
    if (request.method() === "POST") rows.push(body);
    else if (request.method() === "PATCH") {
      assert.equal(u.searchParams.get("user_id"), `eq.${user.id}`);
      const revision = u.searchParams.get("updated_at");
      assert.ok(revision?.startsWith("eq."));
      if (
        revision !==
        `eq.${rows.find((row) => row.key === "cutiq:v2").updated_at}`
      )
        return reply(200, null);
      rows = rows.map((row) =>
        row.key === "cutiq:v2" ? { ...row, ...body } : row,
      );
    } else throw new Error("Unexpected destructive request");
    return reply(
      200,
      request.method() === "PATCH" ? { key: "cutiq:v2" } : body,
    );
  }
  return route.abort();
});
try {
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:5174");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByText("Your old logs have been imported.", { exact: false })
    .waitFor();
  await page.getByLabel("Goal date").fill(addDays(start, 77));
  await page.getByRole("button", { name: "Save my plan" }).click();
  await page.getByText("Legacy lunch", { exact: true }).waitFor();
  assert.equal(writes, 1);
  assert.deepEqual(rows.slice(0, 2), original);
  await page.getByLabel("Steps so far").fill("15000");
  await page.getByRole("button", { name: "Save day", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('.actions [role="status"]')
      ?.textContent.includes("complete days"),
  );
  assert.equal(
    rows.find((r) => r.key === "cutiq:v2").value.logs[0].steps,
    15000,
  );
  assert.deepEqual(rows.slice(0, 2), original);
  rejectSave = true;
  await page.getByLabel("Steps so far").fill("16000");
  await page.getByRole("button", { name: "Save day", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Save failed" }).waitFor();
  assert.equal(await page.getByLabel("Steps so far").inputValue(), "16000");
  assert.equal(
    rows.find((r) => r.key === "cutiq:v2").value.logs[0].steps,
    15000,
  );
  assert.deepEqual(rows.slice(0, 2), original);
  rejectSave = false;
  rows.find((row) => row.key === "cutiq:v2").updated_at =
    "2099-01-01T00:00:00Z";
  await page.getByRole("button", { name: "Save day", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "another tab or device" })
    .waitFor();
  assert.equal(
    rows.find((row) => row.key === "cutiq:v2").value.logs[0].steps,
    15000,
  );
  console.log(
    "PASS mocked account login, legacy migration, non-destructive insert, conditional update and failed-save draft retention",
  );
} finally {
  await browser.close();
}
