import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeTDEE, objectiveE1rmTrend } from './cutEngine.js'
import { createPlanSnapshot, createTargetResolver, getPlanForDate, shiftDay } from './planEngine.js'
import { consistencyHistory } from './consistency.js'

const setup = { age:25, height:178, sex:'male', activity:'mod', startWeight:75, goalWeight:72,
  startDate:'2025-01-01', cutLength:84, stepGoal:10000 }
const date = i => shiftDay(setup.startDate, i)
const plan = (i, logs, extra = {}) => getPlanForDate({ setup, date:date(i), logs, ...extra })
const start = plan(0, []).eatTarget
const series = (length, fields) => Array.from({ length }, (_, i) => ({
  date:date(i), weight:75, steps:10000, meals:[{ cals:start }], ...fields?.(i) }))

test('weight alone, above-target intake and a single flat review hold the actual food target', () => {
  const weights = series(43, () => ({ steps:null, meals:[] }))
  for (const i of [0,14,28,42]) assert.equal(plan(i, weights).eatTarget, start)
  for (const delta of [-350,350]) {
    const logged = series(43, () => ({ meals:[{ cals:start + delta }] }))
    const latest = plan(42, logged)
    assert.equal(latest.eatTarget, start)
    assert.equal(latest.energy.foodReview.food.intake, start + delta)
  }
  const oneFlat = series(36, i => ({ weight:75 - Math.min(i, 28) * .25 / 7 }))
  assert.equal(plan(35, oneFlat).eatTarget, start)
})

test('slow progress at the issued allowance triggers one bounded change then 14 days of observation', () => {
  const rows = series(43, i => {
    const steps = 10000 + (i % 3) * 1000
    const reduction = i >= 35 ? 200 : i >= 21 ? 100 : 0
    return { steps:i % 7 === 3 ? null : steps, meals:[{ cals:start + (steps-10000)*.04 - reduction }] }
  })
  for (const [i, difference] of [[13,0],[14,0],[21,-100],[28,-100],[35,-200],[42,-200]]) {
    const result = plan(i, rows)
    assert.equal(result.energy.target, start + difference)
    assert.equal(result.eatTarget, result.energy.target + result.energy.stepCredit)
  }
  const manual = plan(21, rows, { setup:{ ...setup, manualCalTarget:start } }).energy
  assert.equal(manual.target, start)
  assert.equal(manual.foodReview.suggestedTarget, start - 100)
})

test('known food on a missing-step day still counts towards the intake comparison', () => {
  const rows = series(36, i => i % 7 === 3 ? { steps:null, meals:[{ cals:start+1000 }],
    planSnapshot:{ source:'captured', eatTarget:start } } : {})
  const review = plan(35, rows).energy.foodReview
  assert.equal(review.food.days, 14)
  assert.equal(review.food.intake, Math.round(start + 1000/7))
  assert.equal(review.target, start)
})

test('fast loss on plan increases food once; under-eating or worsening strength veto a reduction', () => {
  const s = { ...setup, goalWeight:68, cutLength:140 }
  const initial = plan(0, [], { setup:s }).eatTarget
  const reports = { strengthReports:[{ weekKey:3, recordedAt:date(21), signal:'down' }, { weekKey:4, recordedAt:date(28), signal:'down' }] }
  const fast = cals => series(36, i => ({ weight:75 - .8 * i / 7, meals:[{ cals }] }))
  const below = plan(28, fast(1550), { setup:s, cutIntel:reports }).energy
  assert.equal(below.target, initial)
  assert.equal(below.muscleRisk.confirmed, true)
  assert.match(below.foodReview.reason, /back to the issued allowance/)
  const at = fast(initial)
  const raised = plan(21, at, { setup:s }).energy.target
  assert.equal(raised, initial + 100)
  assert.equal(plan(28, at, { setup:s }).energy.target, raised)
  assert.equal(plan(28, series(29), { cutIntel:reports }).energy.target, start)
  assert.equal(plan(49, series(50), { cutIntel:reports }).energy.muscleRisk.confirmed, false)
})

test('maintenance is invariant to the order of matched meals even with recurring gaps', () => {
  const options = { windowDays:28, fatFraction:(7700-1800)/(9400-1800), activityForLog:l=>(l.steps-10000)*.04 }
  for (const order of [-1,0,1]) {
    let weight = 75
    const rows = series(28, i => {
      const steps = 8000 + (i % 5) * 1000
      const cals = 2200 + (i >= 26 ? 0 : i >= 7 && i < 20 ? 540 : -540) * order
      const row = { steps, weight, meals:[{ cals }] }
      weight += (cals - 2500 - (steps - 10000)*.04) / 7700
      return row
    })
    assert.equal(analyzeTDEE(rows, options).estimate.tdee, 2500)
    const gaps = rows.map((r,i) => ({ ...r, steps:i%7 === 3 ? null : r.steps, weight:i%4 === 1 ? null : r.weight }))
    const fit = analyzeTDEE(gaps, options)
    assert.equal(fit.estimate.tdee, 2500)
    assert.equal(fit.missingStepsDates.length, 4)
    assert.equal(analyzeTDEE(rows.map(r => ({ ...r, steps:null })), options).estimate, null)
  }
})

test('historical targets agree across the day plan, snapshot and heatmap through a cut and maintenance', () => {
  const rows = series(65, i => ({ weight:Math.max(72,75-i*.075), steps:9000 + i%4*1000 }))
  rows[21].planSnapshot = createPlanSnapshot({ setup, date:date(21), log:rows[21], logs:rows })
  rows[32].planSnapshot = { source:'reconstructed', eatTarget:9999 }
  for (const i of [21,31,32,39,42,50]) rows[i].meals = [{ cals:plan(i,rows).eatTarget }]
  const resolver = createTargetResolver({ setup, logs:rows, asOfDate:date(64) })
  const history = consistencyHistory({ setup, logs:rows, asOfDate:date(64), resolveTargets:resolver })
  for (const [i,row] of rows.entries()) {
    assert.equal(history[i].habits.diet.target, plan(i, rows).eatTarget, row.date)
    assert.equal(history[i].habits.diet.target, resolver(row.date).calories)
  }
  for (const i of [21,31,32,39,42,50]) assert.equal(history[i].habits.diet.status, 'met')
})

test('captured legacy baseline carries over, and retries cannot apply the same weekly adjustment twice', () => {
  const rows = series(43)
  rows[26].planSnapshot = { source:'captured', phase:'cut', modelVersion:6, target:2150, eatTarget:2150 }
  const before = plan(27, rows)
  assert.equal(before.energy.target, 2150)
  assert.equal(plan(28, rows).energy.target, 2150)
  for (let i = 27; i < rows.length; i++) {
    const p = plan(i, rows)
    rows[i].meals = [{ cals:p.eatTarget }]
    rows[i].planSnapshot = createPlanSnapshot({ setup, date:date(i), log:rows[i], logs:rows })
    assert.equal(rows[i].planSnapshot.target, p.energy.target)
  }
  assert.equal(rows[42].planSnapshot.target, 2050)
})

test('version 7 captured food reviews retain their adjustment history after the learning change', () => {
  const rows = series(30)
  const receipt = { date:date(14), target:start, previousTarget:start, suggestedTarget:start, lastChange:null, reason:'Previously issued food review.' }
  rows[16].planSnapshot = { source:'captured', phase:'cut', modelVersion:7, target:start, eatTarget:start, foodReview:receipt }
  assert.deepEqual(plan(17, rows).energy.foodReview, receipt)
})

test('reconstructed targets match the daily plan before and after a delayed midweek first estimate', () => {
  const s = { ...setup, goalWeight:68, cutLength:56 }
  const initial = plan(0, [], { setup:s }).eatTarget
  const rows = series(21, i => ({ weight:i < 7 || i >= 17 ? 75-.8*i/7 : null, meals:[{ cals:initial }] }))
  const resolver = createTargetResolver({ setup:s, logs:rows, asOfDate:date(20) })
  assert.equal(plan(17, rows, { setup:s }).energy.calibration.lastAcceptedReview, date(17))
  assert.ok(plan(17, rows, { setup:s }).eatTarget > plan(16, rows, { setup:s }).eatTarget)
  for (const i of [19,16,17,14,18,15,13]) assert.equal(resolver(date(i)).calories, plan(i, rows, { setup:s }).eatTarget)
})

test('strength evidence uses recent comparable sessions and total load for pull-ups', () => {
  const workout = (i, load, reps=5) => ({ date:date(i), exercises:[{ exerciseId:'pull_up', sets:[{ weight:load, reps, done:true }] }] })
  const rows = series(44)
  const sessions = [workout(1,25), workout(17,20), workout(22,20)]
  const trend = objectiveE1rmTrend(sessions,date(24),rows)
  assert.equal(trend.length, 1)
  assert.equal(Math.round(100 * trend[0].current / trend[0].baseline), 95)
  assert.deepEqual(objectiveE1rmTrend(sessions,date(43),rows), [])
  assert.deepEqual(objectiveE1rmTrend([sessions[0],workout(17,20,8),workout(22,20,8)],date(24),rows), [])
})
