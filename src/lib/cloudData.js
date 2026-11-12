import { restoredSetup, restoredLogs } from "./compatData.js";

// Per-user reads, paginated history, ordered writes and optimistic revisions.
// A read failure must never look like a new account or an empty history.
export function createCloudData(client) {
  let activeUser = null;
  const revisions = new Map();
  const queues = new Map();
  const documents = new Map();
  const owner = async () => {
    if (activeUser) return activeUser;
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data?.user) throw new Error("Sign in to load or save your data.");
    return data.user.id;
  };
  const read = async (userId, key) => {
    const { data, error } = await client
      .from("user_data")
      .select("key,value,updated_at")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    revisions.set(`${userId}:${key}`, data?.updated_at ?? null);
    return data;
  };
  const document = (userId) => {
    if (!documents.has(userId))
      documents.set(
        userId,
        read(userId, "cutiq:v2").catch((error) => {
          documents.delete(userId);
          throw error;
        }),
      );
    return documents.get(userId);
  };
  const core = {
    useUser(userId) {
      activeUser = userId || null;
      documents.clear();
    },
    async get(key) {
      const userId = await owner();
      const row = await read(userId, key);
      if (key === "setup") {
        const newer = await document(userId);
        return restoredSetup(
          row?.value,
          newer?.value,
          !!(
            newer?.updated_at &&
            (!row?.updated_at || newer.updated_at > row.updated_at)
          ),
        );
      }
      if (key.startsWith("log:"))
        return (
          restoredLogs(row ? [row] : [], await document(userId)).find(
            (l) => `log:${l.date}` === key,
          ) ?? null
        );
      return row?.value ?? null;
    },
    async getByPrefix(prefix) {
      const userId = await owner();
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client
          .from("user_data")
          .select("key,value,updated_at")
          .eq("user_id", userId)
          .like("key", `${prefix}%`)
          .order("key")
          .range(offset, offset + 999);
        if (error) throw error;
        for (const row of data || []) {
          rows.push(row);
          revisions.set(`${userId}:${row.key}`, row.updated_at ?? null);
        }
        if (!data || data.length < 1000) break;
      }
      return prefix === "log:"
        ? restoredLogs(rows, await document(userId))
        : rows.map((r) => r.value).filter(Boolean);
    },
    async list(prefix) {
      if (prefix === "log:")
        return (await core.getByPrefix(prefix)).map((l) => `log:${l.date}`);
      const userId = await owner();
      const { data, error } = await client
        .from("user_data")
        .select("key")
        .eq("user_id", userId)
        .like("key", `${prefix}%`);
      if (error) throw error;
      return (data || []).map((r) => r.key);
    },
    async set(key, value, expectedUser) {
      // Resolve identity before queuing: signing out cannot redirect a pending write.
      const userId = await owner();
      if (expectedUser && expectedUser !== userId) return false;
      const id = `${userId}:${key}`;
      const captured = JSON.parse(JSON.stringify(value));
      const previous = queues.get(id) || Promise.resolve();
      const next = previous
        .then(async () => {
          if (expectedUser && activeUser !== expectedUser) return false;
          if (!revisions.has(id)) await read(userId, key);
          const revision = revisions.get(id);
          const updated_at = new Date(
            Math.max(Date.now(), revision ? Date.parse(revision) + 1 : 0),
          ).toISOString();
          if (revision) {
            const { data, error } = await client
              .from("user_data")
              .update({ value: captured, updated_at })
              .eq("user_id", userId)
              .eq("key", key)
              .eq("updated_at", revision)
              .select("key")
              .maybeSingle();
            if (error) throw error;
            if (!data)
              throw new Error(
                "Data changed on another device. Export your current data and reload before editing again.",
              );
          } else {
            const { error } = await client
              .from("user_data")
              .insert({ user_id: userId, key, value: captured, updated_at });
            if (error) throw error;
          }
          revisions.set(id, updated_at);
          return true;
        })
        .catch((error) => {
          console.error("Data save failed", error);
          return false;
        });
      queues.set(id, next);
      const saved = await next;
      if (queues.get(id) === next) queues.delete(id);
      return saved;
    },
    async drain() {
      await Promise.all([...queues.values()]);
    },
  };
  return core;
}
