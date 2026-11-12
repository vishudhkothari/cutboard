import test from "node:test";
import assert from "node:assert/strict";
import { createCloudData } from "./cloudData.js";

function fixture(initial = []) {
  const rows = structuredClone(initial);
  let failing = false;
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "A" } } }) },
    from() {
      let op = "read",
        payload = null,
        fields = "",
        range = [0, Infinity];
      const filters = [];
      const query = {
        select(value) {
          fields = value;
          return query;
        },
        eq(k, v) {
          filters.push((row) => row[k] === v);
          return query;
        },
        like(k, v) {
          filters.push((row) => row[k].startsWith(v.slice(0, -1)));
          return query;
        },
        order() {
          return query;
        },
        range(a, b) {
          range = [a, b];
          return query;
        },
        update(value) {
          op = "update";
          payload = value;
          return query;
        },
        insert(value) {
          op = "insert";
          payload = value;
          return query;
        },
        maybeSingle() {
          return execute(true);
        },
        then(resolve, reject) {
          return execute(false).then(resolve, reject);
        },
      };
      async function execute(single) {
        calls.push({ op, payload, fields });
        if (failing) return { data: null, error: new Error("offline") };
        if (op === "insert") {
          if (
            rows.some(
              (r) => r.user_id === payload.user_id && r.key === payload.key,
            )
          )
            return { error: new Error("duplicate revision") };
          rows.push(structuredClone(payload));
          return { error: null };
        }
        const matched = rows
          .filter((row) => filters.every((f) => f(row)))
          .sort((a, b) => a.key.localeCompare(b.key))
          .slice(range[0], range[1] + 1);
        if (op === "update")
          matched.forEach((row) =>
            Object.assign(row, structuredClone(payload)),
          );
        return { data: single ? (matched[0] ?? null) : matched, error: null };
      }
      return query;
    },
  };
  return {
    client,
    rows,
    calls,
    offline(value) {
      failing = value;
    },
  };
}
const row = (key, value, user_id = "A") => ({
  key,
  value,
  user_id,
  updated_at: "2026-01-01T00:00:00Z",
});

test("cloud reads are explicitly scoped to the selected account", async () => {
  const f = fixture([
    row("setup", { name: "A" }),
    row("setup", { name: "B" }, "B"),
  ]);
  const store = createCloudData(f.client);
  store.useUser("A");
  assert.equal((await store.get("setup")).name, "A");
  store.useUser("B");
  assert.equal((await store.get("setup")).name, "B");
});

test("cloud read failure rejects instead of returning an empty profile/history", async () => {
  const f = fixture();
  f.offline(true);
  const store = createCloudData(f.client);
  store.useUser("A");
  await assert.rejects(store.get("setup"), /offline/);
  await assert.rejects(store.getByPrefix("log:"), /offline/);
});

test("history reads all pages beyond the API default thousand-row limit", async () => {
  const f = fixture(
    Array.from({ length: 1005 }, (_, i) =>
      row(`log:${String(i).padStart(4, "0")}`, {
        date: String(i).padStart(4, "0"),
      }),
    ),
  );
  const store = createCloudData(f.client);
  store.useUser("A");
  assert.equal((await store.getByPrefix("log:")).length, 1005);
});

test("rapid saves to one key are ordered and the newest payload wins", async () => {
  const f = fixture([row("log:2026-01-01", { steps: 10000 })]);
  const store = createCloudData(f.client);
  store.useUser("A");
  assert.deepEqual(
    await Promise.all([
      store.set("log:2026-01-01", { steps: 11000 }),
      store.set("log:2026-01-01", { steps: 15000 }),
    ]),
    [true, true],
  );
  assert.equal(f.rows[0].value.steps, 15000);
});

test("a stale device cannot overwrite a newer cloud revision", async (t) => {
  t.mock.method(console, "error", () => {});
  const f = fixture([row("setup", { name: "Original" })]);
  const a = createCloudData(f.client),
    b = createCloudData(f.client);
  a.useUser("A");
  b.useUser("A");
  await a.get("setup");
  await b.get("setup");
  assert.equal(await a.set("setup", { name: "New" }), true);
  assert.equal(await b.set("setup", { name: "Stale" }), false);
  assert.equal(f.rows[0].value.name, "New");
});

test("an old account draft is rejected after switching users", async () => {
  const f = fixture();
  const store = createCloudData(f.client);
  store.useUser("B");
  assert.equal(await store.set("log:2026-01-01", { steps: 15000 }, "A"), false);
  assert.equal(f.rows.length, 0);
});

test("the v2 bridge is read-only and preserves original-only records", async () => {
  const f = fixture([
    row("setup", { name: "Original" }),
    row("recipes", [{ name: "Dal" }]),
    row("cutiq:v2", {
      logs: [{ date: "2026-01-01", steps: 15000, meals: [] }],
    }),
  ]);
  const store = createCloudData(f.client);
  store.useUser("A");
  assert.equal((await store.get("setup")).name, "Original");
  assert.equal((await store.getByPrefix("log:"))[0].steps, 15000);
  assert.equal((await store.get("recipes"))[0].name, "Dal");
  assert.ok(f.calls.every((call) => call.op === "read"));
});
