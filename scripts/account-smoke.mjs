import { chromium } from "playwright";
import assert from "node:assert/strict";
import { today, shiftDay, getAdaptiveTDEE } from "../src/lib/planEngine.js";

// Two separate accounts through production auth/store code. Fixture RLS checks
// every request against the JWT subject. All non-local network is intercepted.
const date=today();
const users=[
  {id:"11111111-1111-4111-8111-111111111111",email:"account-a@example.com",aud:"authenticated",role:"authenticated"},
  {id:"22222222-2222-4222-8222-222222222222",email:"account-b@example.com",aud:"authenticated",role:"authenticated"},
];
const [a,b]=users;
const profileA={name:"Account A",age:30,height:180,sex:"male",activity:"mod",startWeight:85,startBF:20,goalWeight:79,startDate:shiftDay(date,-20),cutLength:77,stepGoal:10000,manualCalTarget:2000,modelVersion:5};
const profileB={name:"Account B",age:"28",height:"162",sex:"female",activity:"light",startWeight:"68",startBF:"30",goalBF:"22",startDate:shiftDay(date,-20),cutLength:"84",stepGoal:"8000",userMaxStepBudget:"9000",manualCalTarget:"1650",maintenanceSince:shiftDay(date,-5)};
const row=(uid,key,value)=>({user_id:uid,key,value,updated_at:"2026-01-01T00:00:00.000Z"});
const meal=(name)=>({name,cals:450,protein:25,carbs:50,fat:10,fiber:5});
const rows=[
  row(a.id,"setup",profileA),row(b.id,"setup",profileB),
  ...users.flatMap(user=>Array.from({length:16},(_,i)=>{
    const d=shiftDay(date,i-15),isB=user.id===b.id;
    return row(user.id,`log:${d}`,{date:d,weight:isB?String(68-i*.03):85,steps:isB?"8000":10000,sleep:isB?"7.5":8,meals:[meal(isB?"B private lunch":"A private lunch")],foodComplete:true,activityComplete:true});
  })),
  row(b.id,`log:${shiftDay(date,-25)}`,{date:shiftDay(date,-25),weight:50,meals:[]}),
  row(b.id,`log:${shiftDay(date,5)}`,{date:shiftDay(date,5),weight:50,meals:[]}),
  row(b.id,"cut_intel",{stepGoal:30000,strengthReports:[]}),
  row(a.id,"recipes",[{id:"a-recipe",name:"A private recipe",items:[],perServing:{cals:400,protein:20,carbs:50,fat:10,fiber:5}}]),
  row(b.id,"recipes",[]),
  row(a.id,"routines",[{id:"a-routine",name:"A private routine",exercises:[]}]),
  row(b.id,"routines",[{id:"b-routine",name:"B private routine",exercises:[]}]),
  row(a.id,"workout_history",[]),row(b.id,"workout_history",[]),
  {...row(b.id,"cutiq:v2",{profile:{name:"Old profile",age:28,height:162,sex:"female",startWeight:95,goalWeight:80,startDate:profileB.startDate,goalDate:shiftDay(profileB.startDate,84),baselineSteps:12000},logs:[]}),updated_at:"2026-01-02T00:00:00.000Z"},
];
const yesterday=rows.find(r=>r.user_id===b.id&&r.key===`log:${shiftDay(date,-1)}`);
yesterday.value.planSnapshot={source:"captured",eatTarget:0,effMaint:2200};
const tokens=new Map(users.map(user=>[user.id,[
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString("base64url"),"signature",
].join(".")]));
const writes=[],violations=[],errors=[];
let readGate=null,writeGate=null,rejectPhotos=false;
const deferred=()=>{let release,enter;const waiting=new Promise(r=>{release=r}),entered=new Promise(r=>{enter=r});return{release,enter,waiting,entered}};
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||"msedge",headless:true});
const context=await browser.newContext({serviceWorkers:"block"});
const pages=[];
await context.route("**/*",async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method();
  if(["127.0.0.1","localhost"].includes(url.hostname))return route.continue();
  const reply=(status,body)=>route.fulfill({status,contentType:"application/json",headers:{"access-control-allow-origin":"*"},body:JSON.stringify(body)});
  if(method==="OPTIONS")return reply(200,{});
  const jwt=request.headers().authorization?.replace(/^Bearer /i,"");
  const uid=[...tokens].find(([,value])=>value===jwt)?.[0];
  const user=users.find(u=>u.id===uid);
  if(url.pathname.endsWith("/auth/v1/token")){
    const {email}=request.postDataJSON(),next=users.find(u=>u.email===email);
    assert.ok(next,"Unknown fixture account");
    return reply(200,{access_token:tokens.get(next.id),refresh_token:`fixture-${next.id}`,expires_in:3600,token_type:"bearer",user:next});
  }
  if(url.pathname.endsWith("/auth/v1/user"))return reply(user?200:401,user||{message:"Not signed in"});
  if(url.pathname.endsWith("/auth/v1/logout"))return reply(200,{});
  if(url.pathname.endsWith("/rest/v1/shared_foods"))return reply(200,[]);
  if(url.pathname.includes("/storage/v1/object/list/")){
    assert.equal(request.postDataJSON().prefix,uid,"Photos must use the authenticated account folder");
    if(rejectPhotos)return reply(503,{message:"Simulated photo load failure"});
    return reply(200,[]);
  }
  if(!url.pathname.endsWith("/rest/v1/user_data"))return route.abort();
  const payload=method==="POST"?request.postDataJSON():null;
  const requested=method==="POST"?payload.user_id:url.searchParams.get("user_id")?.replace(/^eq\./,"");
  if(!user||requested!==uid){
    violations.push({method,requested,uid});
    return reply(403,{message:"Fixture RLS rejected a cross-account request"});
  }
  const matches=r=>r.user_id===uid&&[...url.searchParams].every(([key,value])=>{
    if(value.startsWith("eq."))return String(r[key])===value.slice(3);
    if(value.startsWith("like."))return r[key]?.startsWith(value.slice(5,-1));
    return true;
  });
  if(method==="GET"){
    const selected=structuredClone(rows.filter(matches));
    if(uid===a.id&&readGate&&url.searchParams.get("key")==="eq.setup"){
      const gate=readGate;readGate=null;gate.enter();await gate.waiting;
    }
    return reply(200,request.headers().accept?.includes("vnd.pgrst.object")?(selected[0]??null):selected);
  }
  if(method==="PATCH"){
    assert.ok(url.searchParams.has("updated_at"),"Updates need a revision check");
    const body=request.postDataJSON();
    if(uid===a.id&&writeGate&&url.searchParams.get("key")===`eq.log:${date}`){
      const gate=writeGate;writeGate=null;gate.enter();await gate.waiting;
    }
    const selected=rows.filter(matches);
    selected.forEach(r=>Object.assign(r,body));
    writes.push({uid,key:selected[0]?.key,value:body.value});
    return reply(200,selected[0]?{key:selected[0].key}:null);
  }
  if(method==="POST"){
    if(rows.some(r=>r.user_id===uid&&r.key===payload.key))return reply(409,{message:"Duplicate record"});
    rows.push(payload);writes.push({uid,key:payload.key,value:payload.value});
    return reply(201,null);
  }
  throw new Error(`Unexpected fixture mutation ${method}`);
});
const newPage=async()=>{const p=await context.newPage();p.setDefaultTimeout(15000);p.on("pageerror",e=>errors.push(e.message));pages.push(p);return p};
const signIn=async(p,user)=>{
  await p.getByPlaceholder("you@email.com").fill(user.email);
  await p.locator('input[type="password"]').fill("fixture-password");
  await p.getByRole("button",{name:"Sign In",exact:true}).last().click();
};
const nav=async(p,name)=>p.getByRole("button",{name,exact:true}).first().click();
const until=async(test,label)=>{for(let i=0;i<100;i++){if(test())return;await new Promise(r=>setTimeout(r,100))}throw new Error(label)};
const within=async(promise,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),20000)})])}finally{clearTimeout(timer)}};
const forbiddenA=async p=>assert.doesNotMatch(await p.locator("body").innerText(),/A private|Account A|NaN|undefined|Infinity|null%/);
let heldRead,heldWrite;
try{
  const first=await newPage();
  await first.goto(process.env.TEST_URL||"http://127.0.0.1:5174");
  await signIn(first,a);
  await first.getByText("of 2000 kcal",{exact:true}).waitFor();
  const second=await newPage();
  await second.goto(process.env.TEST_URL||"http://127.0.0.1:5174");
  await second.getByText("of 2000 kcal",{exact:true}).waitFor();
  heldRead=readGate=deferred();
  const loading=await newPage();
  await loading.goto(process.env.TEST_URL||"http://127.0.0.1:5174");
  await within(heldRead.entered,"The delayed A read was never requested");
  heldWrite=writeGate=deferred();
  await first.getByLabel("Steps",{exact:true}).fill("15000");
  await within(heldWrite.entered,"The delayed A save was never requested");
  await first.getByLabel("Steps",{exact:true}).fill("16000");
  await second.getByRole("button",{name:"Sign Out",exact:true}).click();
  await second.getByPlaceholder("you@email.com").waitFor();
  await signIn(second,b);
  await second.getByText("Edit Profile",{exact:true}).waitFor();
  await second.getByRole("alert").filter({hasText:"Saved versions disagree"}).waitFor();
  assert.equal(writes.filter(w=>w.uid===b.id).length,0,"Loading B must be read-only");
  assert.equal(await second.getByText("Today's Vitals",{exact:true}).count(),0,"Conflicting profile must not produce an invented budget");
  assert.equal(await second.locator('input[placeholder="74.0"]').inputValue(),"68");
  await second.getByRole("button",{name:"Save Changes",exact:true}).click();
  await second.getByText("of 1650 kcal",{exact:true}).waitFor();
  heldRead.release();heldWrite.release();
  await until(()=>rows.find(r=>r.user_id===a.id&&r.key===`log:${date}`).value.steps===15000,"A's in-flight save did not finish");
  for(const p of pages){
    await forbiddenA(p);
    // Other tabs may still display B's unconfirmed copy until they refresh.
    // They must never submit that stale profile over B's confirmed revision.
    if(p!==second){
      assert.equal(await p.locator('input[placeholder="74.0"]').inputValue(),"68");
      await p.reload();
    }
    await p.getByText("of 1650 kcal",{exact:true}).waitFor();
    await forbiddenA(p);
    assert.equal(await p.getByLabel("Weight",{exact:true}).inputValue(),"67.55");
    await p.getByRole("button",{name:/1 item.*450 kcal/}).click();
    await p.getByText("B private lunch",{exact:true}).waitFor();
    await forbiddenA(p);
    assert.equal(await p.getByLabel("Steps",{exact:true}).getAttribute("placeholder"),"9,000","Saved oversized goal must be capped, with no fasting debt");
  }
  assert.equal(rows.find(r=>r.user_id===a.id&&r.key===`log:${date}`).value.steps,15000);
  assert.equal(rows.find(r=>r.user_id===b.id&&r.key===`log:${date}`).value.steps,"8000");
  console.log("PASS two account IDs, JWT-scoped RLS, delayed old-account reads/writes, profile conflict review and complete UI remount");

  await second.getByLabel("Steps",{exact:true}).fill("11000");
  await second.getByText("of 1770 kcal",{exact:true}).waitFor();
  await until(()=>rows.find(r=>r.user_id===b.id&&r.key===`log:${date}`).value.steps===11000,"B's steps were not persisted");
  for(const p of [first,loading]){await p.reload();await p.getByText("of 1770 kcal",{exact:true}).waitFor();await forbiddenA(p)}
  await nav(second,"Nutrition");
  assert.match(await second.locator("body").innerText(),/1770/);
  await forbiddenA(second);
  await nav(second,"Cut IQ");
  await second.getByText("1770 kcal",{exact:true}).waitFor();
  await second.getByText("+120 kcal",{exact:true}).waitFor();
  const model=getAdaptiveTDEE(rows.find(r=>r.user_id===b.id&&r.key==="setup").value,rows.filter(r=>r.user_id===b.id&&r.key.startsWith("log:")).map(r=>r.value),date,rows.find(r=>r.user_id===b.id&&r.key==="cut_intel").value);
  assert.equal(model.phase,"cut");
  assert.equal(model.goalWeight,61);
  assert.match(await second.locator("body").innerText(),/61 kg/);
  console.log("PASS account B string-valued facts, stable 61 kg goal, ignored old maintenance flag, and Today/Nutrition/Cut IQ calorie agreement");
  await nav(second,"Workout");
  await second.getByText("B private routine",{exact:true}).waitFor();
  await forbiddenA(second);
  rejectPhotos=true;
  await nav(second,"Progress");
  await second.getByText("Progress Photos",{exact:true}).waitFor();
  await second.getByRole("alert").filter({hasText:"Simulated photo load failure"}).waitFor();
  assert.equal(await second.getByText(/No photos yet/).count(),0,"A failed photo read must not look like an empty photo library");
  rejectPhotos=false;
  await second.getByRole("button",{name:"Retry photos",exact:true}).click();
  await second.getByText(/No photos yet/).waitFor();
  await forbiddenA(second);
  await nav(second,"Today");
  await second.getByLabel("Sleep",{exact:true}).fill("7");
  await second.getByRole("button",{name:"Sign Out",exact:true}).click();
  await second.getByPlaceholder("you@email.com").waitFor();
  await signIn(second,a);
  await second.getByText("of 2200 kcal",{exact:true}).waitFor();
  assert.doesNotMatch(await second.locator("body").innerText(),/B private|Account B/);
  assert.equal(rows.find(r=>r.user_id===a.id&&r.key==="setup").value.startWeight,85);
  assert.equal(rows.find(r=>r.user_id===b.id&&r.key==="setup").value.startWeight,68);
  assert.deepEqual(violations,[]);
  assert.deepEqual(errors,[]);
  await second.getByRole("alert").filter({hasText:"Unsynced edits remain"}).waitFor();
  await second.getByRole("button",{name:`Restore draft for ${date}`,exact:true}).click();
  await second.getByText("of 2240 kcal",{exact:true}).waitFor();
  await until(()=>rows.find(r=>r.user_id===a.id&&r.key===`log:${date}`).value.steps===16000,"A's recovered edit was not saved");
  await second.reload();
  await second.getByText("of 2240 kcal",{exact:true}).waitFor();
  assert.equal(await second.getByRole("alert").filter({hasText:"Unsynced edits remain"}).count(),0);
  console.log("PASS private routines/photos stay scoped, sign-out flushes B's edits, and A's interrupted edit survives account switching and can be recovered");
}catch(error){
  for(let i=0;i<pages.length;i++)console.log(`PAGE ${i}: ${(await pages[i].locator("body").innerText()).slice(-2200)}`);
  throw error;
}finally{
  heldRead?.release();heldWrite?.release();
  await browser.close();
}
