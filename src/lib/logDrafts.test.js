import test from "node:test";
import assert from "node:assert/strict";
import { createLogDrafts } from "./logDrafts.js";
const fixture=()=>{
  const data=new Map();
  return {get length(){return data.size},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
};
test("account switching cannot show or acknowledge another account's recovery copy",()=>{
  const storage=fixture(),a=createLogDrafts(storage,"A"),b=createLogDrafts(storage,"B");
  const log={date:"2026-11-12",steps:16000};
  assert.equal(a.put(log),true);
  assert.deepEqual(b.list(),[]);
  assert.equal(b.acknowledge(log),false);
  assert.deepEqual(createLogDrafts(storage,"A").list(),[log],"Recovery survives a new workspace instance");
});
test("acknowledging an earlier write cannot erase a newer unsaved edit",()=>{
  const drafts=createLogDrafts(fixture(),"A");
  const first={date:"2026-11-12",steps:15000},next={...first,steps:16000};
  drafts.put(first);drafts.put(next);
  assert.equal(drafts.acknowledge(first),false);
  assert.deepEqual(drafts.list(),[next]);
  assert.equal(drafts.acknowledge(next),true);
  assert.deepEqual(drafts.list(),[]);
});
test("a local storage failure is reported without blocking cloud data",()=>{
  const drafts=createLogDrafts({setItem(){throw new Error("quota")},get length(){throw new Error("blocked")}},"A");
  assert.equal(drafts.put({date:"2026-11-12"}),false);
  assert.deepEqual(drafts.list(),[]);
});
