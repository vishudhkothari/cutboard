import { supabase } from "./supabase";
import { today } from "./cutEngine";
import { emptyState, migrateLegacy, validateState } from "./data";

export const cloudEnabled =
  !!(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
  ) && import.meta.env.VITE_DEMO !== "1";
const KEY = "cutiq:v2";
const LOCAL_KEY = import.meta.env.VITE_DEMO === "1" ? "cutiq:v2:demo" : KEY;
const revisions = new Map();
const conflict = () =>
  new Error(
    "Data changed in another tab or device. Export your current data, then reload before saving again.",
  );

export async function loadState(userId) {
  if (!cloudEnabled) {
    const raw = localStorage.getItem(LOCAL_KEY);
    revisions.set("local", raw);
    return validateState(raw ? JSON.parse(raw) : emptyState());
  }
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("user_data")
      .select("key,value,updated_at")
      .eq("user_id", userId)
      .order("key")
      .range(offset, offset + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const current = rows.find((row) => row.key === KEY);
  revisions.set(userId, current?.updated_at ?? null);
  return validateState(current?.value || migrateLegacy(rows));
}
export async function saveState(state, userId) {
  validateState(state);
  if (!cloudEnabled) {
    const write = () => {
      if (localStorage.getItem(LOCAL_KEY) !== revisions.get("local"))
        throw conflict();
      const raw = JSON.stringify(state);
      localStorage.setItem(LOCAL_KEY, raw);
      revisions.set("local", raw);
    };
    // Coordinate simultaneous writes across same-origin tabs when supported.
    if (navigator.locks) await navigator.locks.request(LOCAL_KEY, write);
    else write();
    return;
  }
  const previous = revisions.get(userId);
  const row = {
    value: state,
    updated_at: new Date(
      Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0),
    ).toISOString(),
  };
  if (previous) {
    // Compare-and-swap prevents a stale device from silently overwriting newer logs.
    const { data, error } = await supabase
      .from("user_data")
      .update(row)
      .eq("user_id", userId)
      .eq("key", KEY)
      .eq("updated_at", previous)
      .select("key")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw conflict();
  } else {
    const { error } = await supabase
      .from("user_data")
      .insert({ user_id: userId, key: KEY, ...row });
    if (error?.code === "23505") throw conflict();
    if (error) throw error;
  }
  revisions.set(userId, row.updated_at);
}
export function exportState(state) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `cutiq-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
