import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarYear, consistencyDay, consistencyHistory, consistencyStats, habitHasData } from './consistency.js'
import { createPlanSnapshot, shiftDay, today } from './planEngine.js'

const date = today()
const targets = { calorieTarget: 2000, stepGoal: 10000 }
const full = fields => ({ date, meals: [{ cals: 2000 }], foodComplete: true, steps: 10000, activityComplete: true, sleep: 7, ...fields })
const setup = { age: 30, height: 180, sex: 'male', startWeight: 85, startBF: 20, goalWeight: 79, goalBF: 12, startDate: shiftDay(date, -10), cutLength: 77, stepGoal: 10000, activity: 'mod', manualCalTarget: 2000 }

test('saved food, steps and sleep count without any completion switches', () => {
  assert.equal(consistencyDay(full(), targets).score, 3)
  for (const flags of [{ foodComplete: false, activityComplete: false }, { foodComplete: undefined, activityComplete: undefined }]) {
    const saved = consistencyDay(full(flags), targets)
    assert.equal(saved.score, 3)
    assert.equal(saved.habits.diet.status, 'met')
    assert.equal(saved.habits.steps.status, 'met')
  }
  assert.equal(consistencyDay(full({ sleep: 6.9 }), targets).score, 2)
})

test('diet rewards the target window, including the 75 kcal minimum tolerance', () => {
  for (const cals of [1900, 2000, 2100]) assert.equal(consistencyDay(full({ meals: [{ cals }] }), targets).habits.diet.status, 'met')
  for (const cals of [0, 500, 1899, 2101]) assert.equal(consistencyDay(full({ meals: [{ cals }] }), targets).habits.diet.status, 'missed')
  assert.equal(consistencyDay(full({ meals: [{ cals: 1475 }] }), { ...targets, calorieTarget: 1400 }).habits.diet.status, 'met')
  assert.equal(consistencyDay(full({ meals: [{ cals: 1476 }] }), { ...targets, calorieTarget: 1400 }).habits.diet.status, 'missed')
  assert.equal(consistencyDay(full({ meals: [] }), targets).habits.diet.status, 'missed')
  assert.equal(consistencyDay(full({ meals: [{ cals: NaN }] }), targets).habits.diet.status, 'invalid')
})

test('missing records, zero values and unknown targets remain distinct', () => {
  assert.equal(habitHasData(consistencyDay(null)), false)
  const zero = consistencyDay(full({ meals: [], steps: 0, sleep: 0 }), targets)
  assert.equal(zero.score, 0)
  assert.equal(habitHasData(zero), true)
  assert.equal(zero.habits.sleep.status, 'missed')
  assert.equal(consistencyDay(full({ steps: 0 }), { ...targets, stepGoal: 0 }).habits.steps.status, 'met')
  const unknown = consistencyDay(full())
  assert.equal(unknown.habits.diet.status, 'unknown')
  assert.equal(unknown.habits.steps.status, 'unknown')
  assert.equal(consistencyDay(full({ steps: null, sleep: '' }), targets).score, 1)
})

test('disputed facts never earn a habit target and do not hide undisputed facts', () => {
  const day = consistencyDay(full({ recordNeedsReview: true, recordReviewFields: ['meals', 'sleep'] }), targets)
  assert.equal(day.habits.diet.status, 'review')
  assert.equal(day.habits.sleep.status, 'review')
  assert.equal(day.habits.steps.status, 'met')
  assert.equal(day.score, 1)
})

test('retired confirmation metadata alone cannot turn honest logging into a conflict', () => {
  const day = consistencyDay(full({ foodComplete: false, activityComplete: false, recordNeedsReview: true, recordReviewFields: ['foodComplete', 'activityComplete'] }), targets)
  assert.equal(day.score, 3)
})

test('empty and measurements-only days cannot invent zero food, steps or sleep', () => {
  for (const fields of [{}, { measurements: { waistIn: 34 } }]) {
    const day = consistencyDay({ date, meals: [], foodComplete: false, ...fields }, targets)
    assert.equal(day.score, 0)
    for (const habit of ['diet', 'steps', 'sleep']) assert.equal(day.habits[habit].status, 'missing')
  }
})

test('captured daily calories and step goals survive later profile changes', () => {
  const yesterday = shiftDay(date, -1)
  const log = full({ date: yesterday, steps: 8000, planSnapshot: { source: 'captured', eatTarget: 2000, stepGoal: 8000 } })
  const days = consistencyHistory({ logs: [log], setup: { ...setup, stepGoal: 12000, manualCalTarget: 2400 }, asOfDate: date })
  const historical = days.find(day => day.date === yesterday)
  assert.equal(historical.score, 3)
  assert.equal(historical.estimatedTargets, false)
  assert.equal(days.at(-1).score, 0)
  const snapshot = createPlanSnapshot({ date, log: full(), setup, logs: [full()], cutIntel: { stepGoal: 12000 } })
  assert.equal(snapshot.stepGoal, 12000)
})

test('older logs use the current shared plan and a changed current-day goal is live', () => {
  const yesterday = full({ date: shiftDay(date, -1), steps: 15000, meals: [{ cals: 2200 }], planSnapshot: { source: 'reconstructed', eatTarget: 999, stepGoal: 99999 } })
  const current = full({ planSnapshot: { source: 'captured', eatTarget: 999, stepGoal: 99999 } })
  const days = consistencyHistory({ logs: [yesterday, current], setup, asOfDate: date })
  assert.equal(days.at(-2).score, 3)
  assert.equal(days.at(-2).habits.diet.target, 2200)
  assert.equal(days.at(-2).estimatedTargets, true)
  assert.equal(days.at(-1).score, 3)
  assert.equal(days.at(-1).habits.diet.target, 2000)
})

test('logged values count immediately while missing days still show targets without earning them', () => {
  const days = consistencyHistory({ logs: [full({ foodComplete: false, activityComplete: false })], setup, asOfDate: date })
  assert.equal(days.at(-1).habits.diet.target, 2000)
  assert.equal(days.at(-1).habits.diet.status, 'met')
  assert.equal(days.at(-1).score, 3)
  assert.equal(days.at(-2).habits.diet.target, 2000)
  assert.equal(days.at(-2).habits.steps.target, 10000)
  assert.equal(days.at(-2).habits.diet.status, 'missing')
  assert.equal(days.at(-2).score, 0)
})

test('a historical zero target is preserved and cannot reward zero food intake', () => {
  const yesterday = full({ date: shiftDay(date, -1), meals: [], planSnapshot: { source: 'captured', eatTarget: 0, stepGoal: 10000 } })
  const day = consistencyHistory({ logs: [yesterday], setup, asOfDate: date }).at(-2)
  assert.equal(day.habits.diet.target, 0)
  assert.equal(day.habits.diet.status, 'unknown')
  assert.equal(day.score, 2)
  assert.equal(day.estimatedTargets, false)
})

test('history contains calendar gaps and excludes future and pre-plan records', () => {
  const start = shiftDay(date, -2)
  const days = consistencyHistory({ logs: [full({ date: shiftDay(start, -1) }), full({ date: start }), full({ date: shiftDay(date, 1) })], setup: { ...setup, startDate: start }, asOfDate: date })
  assert.deepEqual(days.map(day => day.date), [start, shiftDay(start, 1), date])
  assert.equal(days[0].score, 3)
  assert.equal(habitHasData(days[1]), false)
  assert.deepEqual(consistencyHistory({ setup: { ...setup, startDate: shiftDay(date, 1) }, asOfDate: date }), [])
})

test('an unfinished today preserves yesterday’s streak, while a missing past day breaks it', () => {
  const records = [0, 1, 2, 3, 4].map(offset => ({ ...consistencyDay(full(), targets), date: shiftDay(date, offset - 4) }))
  records.at(-1).score = 1
  assert.deepEqual(consistencyStats(records, 'all', date), { current: 4, best: 4 })
  records[2] = { ...consistencyDay(null), date: records[2].date }
  assert.deepEqual(consistencyStats(records, 'all', date), { current: 1, best: 2 })
  assert.deepEqual(consistencyStats(records, 'sleep', date), { current: 2, best: 2 })
  assert.deepEqual(consistencyStats([], 'all', date), { current: 0, best: 0 })
})

test('year calendars align Sunday columns and include leap days without timezone drift', () => {
  for (const year of [2024, 2026, 2028]) {
    const dates = calendarYear(year)
    assert.equal(dates.length % 7, 0)
    assert.equal(new Date(`${dates[0]}T12:00:00Z`).getUTCDay(), 0)
    assert.equal(new Date(`${dates.at(-1)}T12:00:00Z`).getUTCDay(), 6)
    assert.equal(dates.filter(day => day.startsWith(String(year))).length, year === 2026 ? 365 : 366)
    assert.equal(new Set(dates).size, dates.length)
  }
  assert.ok(calendarYear(2028).includes('2028-02-29'))
})
