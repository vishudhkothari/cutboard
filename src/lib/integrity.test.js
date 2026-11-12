import test from "node:test";
import assert from "node:assert/strict";
import { getAdaptiveTDEE, getPlanForDate, getDynamicStepGoal, shiftDay } from "./planEngine.js";
import { normalizeProfile, normalizeLog } from "./modelInputs.js";
import { restoredSetup, restoredLogs } from "./compatData.js";

const date="2026-11-12";
const profile={age:27,height:178,sex:"male",activity:"mod",startWeight:90,startBF:25,goalBF:12,startDate:"2026-10-01",cutLength:90,stepGoal:10000};
const log=(i,fields={})=>({date:shiftDay(profile.startDate,i),weight:90-i*.1,steps:10000,meals:[{name:"Lunch",cals:2000}],foodComplete:true,activityComplete:true,...fields});

test("starting-composition fallback is a fixed scale goal across weights, anchors and strength reports",()=>{
  const logs=Array.from({length:43},(_,i)=>log(i));
  const first=getAdaptiveTDEE(profile,[],profile.startDate);
  const later=getAdaptiveTDEE(profile,logs,date,{anchor:{date,weight:85.8,bf:15},strengthReports:[{recordedAt:date,weekKey:6,signal:"down"}]});
  assert.equal(first.goalWeight,76.7);
  assert.equal(later.goalWeight,first.goalWeight);
  assert.equal(later.review.goalWeight,later.goalWeight);
  assert.equal(later.projection.goalWeight,later.goalWeight);
  assert.equal(profile.goalWeight,undefined,"read-only normalization cannot rewrite stored settings");
});

test("numeric strings and numbers produce identical energy, phase and pace",()=>{
  const logs=Array.from({length:43},(_,i)=>log(i));
  const stringify=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,typeof v==="number"?String(v):v]));
  const strings=logs.map(l=>({...stringify(l),meals:l.meals.map(stringify)}));
  const a=getAdaptiveTDEE(profile,logs,date),b=getAdaptiveTDEE(stringify(profile),strings,date);
  for(const key of ["base","target","goalWeight","curW","currentWeight","phase","deficit","stepGoal"])
    assert.equal(b[key],a[key],key);
  assert.deepEqual(b.review,a.review);
  assert.deepEqual(b.projection,a.projection);
});

test("invalid profiles produce a review state and no invented calorie budget",()=>{
  for(const change of [{sex:"unknown"},{age:""},{activity:""},{startWeight:"broken"},{goalWeight:95},{startDate:"2026-02-30"},{cutLength:3},{cutLength:14.5},{stepGoal:10000.5},{manualCalTarget:"bad"}]){
    const model=getAdaptiveTDEE({...profile,...change},[],date);
    assert.equal(model.valid,false,JSON.stringify(change));
    assert.equal(model.target,null);
    assert.equal(model.phase,"review_profile");
    assert.ok(model.inputIssues.length);
  }
});

test("future, pre-cut and duplicate records cannot manufacture current weight or goal confirmation",()=>{
  const scoped=[log(40),log(41),log(42)];
  const base=getAdaptiveTDEE(profile,scoped,date);
  const extra=[...scoped,log(-10,{weight:50}),log(45,{weight:50}),log(41,{...scoped[1]})];
  const result=getAdaptiveTDEE(profile,extra,date);
  for(const key of ["phase","goalWeight","base","target","latestWeight","currentWeight"])
    assert.equal(result[key],base[key],key);
  assert.deepEqual(result.review,base.review);
});

test("a restarted cut cannot inherit the previous cut's goal confirmation or strength signal",()=>{
  const s={...profile,startDate:"2026-11-01",startWeight:85,goalWeight:80,maintenanceSince:"2026-10-25"};
  const logs=Array.from({length:20},(_,i)=>({date:shiftDay("2026-10-01",i),weight:79}));
  const model=getAdaptiveTDEE(s,logs,date,{strengthSignal:"down",strengthReports:[{recordedAt:"2026-10-14",weekKey:1,signal:"down"}]});
  assert.equal(model.phase,"cut");
  assert.equal(model.latestWeight,85);
  assert.equal(model.strengthSignal,null);
  assert.equal(model.anchor.date,s.startDate);
});

test("an unsupported old maintenance flag does not terminate an unfinished cut",()=>{
  const m=getAdaptiveTDEE({...profile,goalWeight:75,maintenanceSince:"2026-11-01"},[log(42)],date);
  assert.equal(m.phase,"cut");
  assert.equal(m.reachedDate,null);
});

test("missing new weights cannot tighten a budget or claim a current plateau",()=>{
  const s={...profile,startDate:"2026-10-01",cutLength:90};
  const logs=[log(5),log(6),log(7)];
  const before=getAdaptiveTDEE(s,logs,"2026-10-15");
  const later=getAdaptiveTDEE(s,logs,"2026-11-12");
  assert.equal(later.target,before.target);
  assert.equal(later.base,before.base);
  assert.equal(later.review.status,"learning");
  assert.equal(later.projection.early,true);
});

test("outlier weights are preserved but cannot move the plan or end the cut",()=>{
  const logs=Array.from({length:15},(_,i)=>log(28+i,{weight:86}));
  logs[12].weight=50;
  const m=getAdaptiveTDEE(profile,logs,date);
  assert.equal(m.phase,"cut");
  assert.equal(m.curW,86);
  assert.ok(m.excludedWeights.includes(logs[12].date));
  assert.equal(logs[12].weight,50);
});

test("saved over-large fitness goals are capped independently of food and fasting snapshots",()=>{
  const s={...profile,stepGoal:8000,userMaxStepBudget:11750};
  const debt=[log(41,{meals:[{cals:3000}],planSnapshot:{eatTarget:0,source:"captured"}})];
  const fitness=getDynamicStepGoal(s,debt,30000);
  assert.equal(fitness.goal,11750);
  assert.equal(fitness.outstandingKcal,0);
  assert.equal(fitness.capped,true);
  assert.equal(getAdaptiveTDEE(s,debt,date,{stepGoal:30000}).stepGoal,11750);
});

test("extra-step credit preserves the same deficit across different valid adult profiles",()=>{
  for(const sex of ["male","female"])for(const stepGoal of [0,8000,10000,20000])for(const kg of [50,75,110]){
    const s={...profile,sex,startWeight:kg,goalWeight:kg-5,startBF:null,goalBF:null,stepGoal};
    const todayLog={date,steps:stepGoal,meals:[]};
    const a=getPlanForDate({date,log:todayLog,setup:s,logs:[]});
    const b=getPlanForDate({date,log:{...todayLog,steps:stepGoal+5000},setup:s,logs:[]});
    assert.equal(b.eatTarget-a.eatTarget,200);
    assert.equal(b.maintenance-a.maintenance,200);
    assert.equal(b.deficit,a.deficit);
    assert.ok(Number.isFinite(b.energy.base));
  }
});

test("whole-document edits cannot silently replace an older original profile",()=>{
  const original={...profile,startWeight:85};
  const document={profile:{age:27,height:178,sex:"male",startWeight:65,goalWeight:60,startDate:profile.startDate,goalDate:shiftDay(profile.startDate,90),baselineSteps:10000}};
  const result=restoredSetup(original,document,true);
  assert.equal(result.startWeight,85);
  assert.equal(result.profileNeedsReview,true);
  assert.equal(getAdaptiveTDEE(result,[],date).valid,false);
  assert.equal(restoredSetup({...original,modelVersion:4},document,true).profileNeedsReview,undefined);
  assert.equal(original.profileNeedsReview,undefined);
});

test("equivalent numeric strings and a derived goal are not migration conflicts",()=>{
  const document={profile:{age:"27",height:"178",sex:"male",startWeight:"90",goalWeight:"76.7",startDate:profile.startDate,goalDate:shiftDay(profile.startDate,90),baselineSteps:"10000"}};
  assert.equal(restoredSetup(profile,document,true),profile);
});

test("identical imported facts cannot erase an old captured target",()=>{
  const raw=log(1,{sleep:8,planSnapshot:{eatTarget:1900}});
  const rows=[{key:`log:${raw.date}`,value:raw,updated_at:"2026-01-01"}];
  const doc={value:{logs:[{date:raw.date,steps:"10000",weight:String(raw.weight),meals:raw.meals}]},updated_at:"2026-01-02"};
  assert.equal(restoredLogs(rows,doc)[0].planSnapshot.eatTarget,1900);
});

test("conflicting imported facts cannot feed calories or goal confirmation until reviewed",()=>{
  const raw=log(42,{steps:10000});
  const rows=[{key:`log:${raw.date}`,value:raw,updated_at:"2026-01-01"}];
  const doc={value:{logs:[{...raw,steps:20000,weight:50}]},updated_at:"2026-01-02"};
  const result=restoredLogs(rows,doc)[0];
  assert.equal(result.recordNeedsReview,true);
  assert.equal(result.steps,20000);
  const s={...profile,manualCalTarget:2000};
  assert.equal(getPlanForDate({date,setup:s,log:result,logs:[result]}).eatTarget,2000);
  const reviewed={...result,recordNeedsReview:false};
  assert.equal(getPlanForDate({date,setup:s,log:reviewed,logs:[reviewed]}).eatTarget,2400);
  assert.equal(rows[0].value.steps,10000);
});

test("invalid optional facts disable their inference without mutating source records",()=>{
  const raw={date,weight:"oops",steps:"bad",meals:[{name:"Lunch",cals:"abc"}],foodComplete:true,activityComplete:true};
  const result=normalizeLog(raw);
  assert.ok(result.errors.length>=3);
  assert.equal(result.value.weight,null);
  assert.equal(result.value.foodComplete,false);
  assert.equal(result.value.activityComplete,false);
  assert.equal(raw.weight,"oops");
  assert.equal(normalizeProfile({...profile,goalWeight:75,startBF:""}).value.startBF,null);
});

test("a planned future cut still shows today's food and movement at maintenance",()=>{
  const s={...profile,startDate:shiftDay(date,7)};
  const todayLog={date,steps:15000,meals:[{name:"Lunch",cals:500}]};
  const p=getPlanForDate({date,setup:s,log:todayLog,logs:[]});
  assert.equal(p.energy.phase,"planned");
  assert.equal(p.eatTarget,p.energy.base+200);
  assert.equal(p.energy.records[0].meals[0].cals,500);
  assert.equal(p.deficit,0);
});

test("a low mean without a majority of goal readings asks for confirmation rather than declaring a completion date",()=>{
  const s={...profile,goalWeight:79};
  const logs=[-12,-11,-10].map(i=>({date:shiftDay(date,i),weight:80}));
  logs.push(...[-2,-1,0].map((i,j)=>({date:shiftDay(date,i),weight:[78,79.4,79.4][j]})));
  const m=getAdaptiveTDEE(s,logs,date);
  assert.equal(m.phase,"cut");
  assert.equal(m.projection.early,true);
  assert.match(m.projection.reason,/confirm/);
  assert.equal(m.projection.dateMid,undefined);
});

test("with an explicit scale goal, uncertain BF estimates cannot change the resting-energy equation or food budget",()=>{
  const s={...profile,goalWeight:75};
  const a=getAdaptiveTDEE({...s,startBF:15},[],date),b=getAdaptiveTDEE({...s,startBF:35},[],date);
  assert.equal(a.bmr,Math.round(10*90+6.25*178-5*27+5));
  for(const key of ["base","target","deficit","goalWeight"])
    assert.equal(a[key],b[key],key);
});

test("changing usual steps shifts baseline expenditure once, without losing movement already completed",()=>{
  const s={...profile,startDate:date,cutLength:140,goalWeight:85,activityReferenceSteps:10000};
  const l={date,steps:15000,meals:[]};
  const a=getPlanForDate({date,setup:s,log:l,logs:[]});
  const b=getPlanForDate({date,setup:{...s,stepGoal:15000},log:l,logs:[]});
  assert.equal(b.energy.base-a.energy.base,200);
  assert.equal(b.energy.stepCredit,0);
  assert.equal(a.energy.stepCredit,200);
  assert.equal(a.maintenance,b.maintenance);
  assert.equal(a.eatTarget,b.eatTarget);
  assert.equal(a.deficit,b.deficit);
});

test("relabeling usual steps preserves learned energy evidence and the same actual-day budget",()=>{
  const s={...profile,goalWeight:85,cutLength:140,activityReferenceSteps:10000};
  const logs=Array.from({length:43},(_,i)=>log(i));
  logs.at(-1).steps=15000;
  const a=getAdaptiveTDEE(s,logs,date),b=getAdaptiveTDEE({...s,stepGoal:15000},logs,date);
  assert.equal(a.isDataDriven,true);
  assert.equal(b.isDataDriven,true);
  assert.equal(b.base-a.base,200);
  assert.equal(b.effMaint,a.effMaint);
  assert.equal(b.target+b.activityCredit,a.target+a.activityCredit);
  assert.equal(b.deficit,a.deficit);
});

test("uneven weigh-in dates use elapsed time instead of treating every pair of weekly means as seven days apart",()=>{
  const logs=[-13,-12,-11,-2,-1,0].map(i=>({date:shiftDay(date,i),weight:88.7-i*.1}));
  const m=getAdaptiveTDEE({...profile,goalWeight:75},logs,date);
  assert.equal(m.review.actualRateKg,.7);
  assert.equal(m.review.status,"on_track");
});

test("six weights straddling a week boundary cannot manufacture two weeks of pace evidence",()=>{
  const logs=[-9,-8,-7,-6,-5,-4].map(i=>({date:shiftDay(date,i),weight:85}));
  const m=getAdaptiveTDEE(profile,logs,date);
  assert.equal(m.review.status,"learning");
  assert.equal(m.review.actualRateKg,null);
  assert.equal(m.projection.early,true);
});

test("incoherent routine assumptions cannot produce a negative expenditure or a fake allowance",()=>{
  const m=getAdaptiveTDEE({...profile,stepGoal:100000},[],date);
  assert.equal(m.valid,false);
  assert.equal(m.target,null);
  assert.equal(m.base,null);
  assert.match(m.inputIssues.join(" "),/usual-step/);
});

test("imported food mappings and notes are retained for review even when calories are identical",()=>{
  const original=log(42,{steps:15000,notes:"Original note"});
  const imported={...original,notes:"Updated note",meals:original.meals.map(m=>({...m,foodId:"mapped-food",amount:100,micros:{iron:4}}))};
  const [restored]=restoredLogs([{key:`log:${date}`,value:original,updated_at:"2026-01-01"}],{value:{logs:[imported]},updated_at:"2026-01-02"});
  assert.equal(restored.meals[0].foodId,"mapped-food");
  assert.equal(restored.notes,"Updated note");
  assert.deepEqual(restored.recordReviewFields,["meals","notes"]);
  const energy=getAdaptiveTDEE({...profile,manualCalTarget:2000},[restored],date);
  assert.equal(energy.stepCredit,200,"Undisputed steps remain usable");
  assert.equal(energy.latestWeight,original.weight,"Undisputed weight remains usable");
  assert.equal(energy.records[0].foodComplete,false,"Disputed meals cannot calibrate energy");
});
