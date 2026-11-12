import test from 'node:test'
import assert from 'node:assert/strict'
import {
  proteinTargetForWeight,
  compositeEnergyDensity,
  leannessRateMultiplier,
  stepCeiling,
  normalizeStepTarget,
  evaluateMuscleRisk,
  tdeeConfidence,
  paceController,
  suggestRefeed,
  inferBodyComp,
} from './cutEngine.js'

const paceBase = overrides => paceController({
  currentWeight: 80,
  currentBF: 18,
  goalBF: 12,
  leanMass: 65,
  daysLeft: 30,
  actualWeeklyRateKg: -0.2,
  currentSteps: 8000,
  baselineSteps: 8000,
  baselineStepAvg: 8000,
  dataDays: 14,
  hasRate: true,
  recentAvgSteps: 8000,
  recentStepDays: 7,
  ...overrides,
})

test('protein target scales with weight and respects configured bounds', () => {
  assert.equal(proteinTargetForWeight(80), 160)
  assert.equal(proteinTargetForWeight(40), 110)
  assert.equal(proteinTargetForWeight(140), 220)
  assert.equal(proteinTargetForWeight(80, { factor: 1.8 }), 144)
})

test('composite energy density defaults to 85% fat loss and responds to composition', () => {
  assert.equal(compositeEnergyDensity(), 8260)
  assert.equal(compositeEnergyDensity(1), 9400)
  assert.equal(compositeEnergyDensity(0), 1800)
})

test('TDEE confidence increases with coverage, span, and data points', () => {
  const early = tdeeConfidence({ coverage: 0.6, trendSpanDays: 7, dataPoints: 5 })
  const mature = tdeeConfidence({ coverage: 1, trendSpanDays: 42, dataPoints: 18 })
  assert.ok(mature > early)
  assert.ok(early >= 0.1 && mature <= 0.9)
})

test('leanness taper lowers rate capacity as current BF approaches goal BF', () => {
  assert.equal(leannessRateMultiplier(25, 12), 1)
  assert.equal(leannessRateMultiplier(12, 12), 0.75)
  assert.ok(leannessRateMultiplier(18, 12) < 1)
})

test('composition model exposes current modeled lean mass for goal calculations', () => {
  const result = inferBodyComp({
    logs: [
      { date: '2026-01-01', weight: 80 },
      { date: '2026-01-08', weight: 70 },
    ],
    anchor: { date: '2026-01-01', weight: 80, bf: 20 },
    strengthSignal: 'same',
    startDate: '2026-01-01',
  })
  assert.ok(result.leanMass < 64)
})

test('step ceiling is the lower of user budget and baseline plus 4000', () => {
  assert.equal(stepCeiling({ baselineStepAvg: 8000 }), 12000)
  assert.equal(stepCeiling({ baselineStepAvg: 12000 }), 14000)
  assert.equal(stepCeiling({ baselineStepAvg: 12000, userMaxStepBudget: 13000 }), 13000)
})

test('step targets never expose fractional daily goals', () => {
  assert.equal(normalizeStepTarget(6964.286), 7000)
  assert.equal(normalizeStepTarget(8051), 8100)
  assert.equal(normalizeStepTarget(null, 8000), 8000)
})

test('one Down report is watch-only, two consecutive reports confirm muscle risk', () => {
  assert.equal(evaluateMuscleRisk({ strengthReports: [{ weekKey: 1, signal: 'down' }] }).confirmed, false)
  assert.equal(evaluateMuscleRisk({ strengthReports: [
    { weekKey: 1, signal: 'down' },
    { weekKey: 2, signal: 'down' },
  ] }).confirmed, true)
})

test('confirmed muscle risk overrides active movement cooldown', () => {
  const result = paceBase({ strengthSignal: 'down', stepAdjustmentEligible: false })
  assert.equal(result.status, 'muscle_risk')
})

test('single Down report remains on the normal pace branch but exposes a watch flag', () => {
  const result = paceBase({ strengthSignal: 'down', muscleRisk: { confirmed: false, watch: true } })
  assert.notEqual(result.status, 'muscle_risk')
  assert.equal(result.muscleWatch, true)
})

test('incomplete movement is only an adherence gate when a pace change is indicated', () => {
  const onTrack = paceBase({ daysLeft: 100, actualWeeklyRateKg: -0.5, recentAvgSteps: 6000 })
  assert.notEqual(onTrack.status, 'movement_adherence')
  const offTrack = paceBase({ actualWeeklyRateKg: -0.05, recentAvgSteps: 6000 })
  assert.equal(offTrack.status, 'movement_adherence')
})

test('unsafe deadline warning remains visible inside the final seven days', () => {
  const result = paceBase({ daysLeft: 3, leanMass: 60, actualWeeklyRateKg: -0.5 })
  assert.equal(result.goalTooAggressive, true)
})

test('calorie cooldown blocks a second food adjustment', () => {
  const result = paceBase({
    currentSteps: 12000,
    baselineSteps: 8000,
    baselineStepAvg: 8000,
    currentCardioMin: 90,
    actualWeeklyRateKg: -0.02,
    recentAvgSteps: 12000,
    recentStepDays: 7,
    calorieAdjustmentEligible: false,
  })
  assert.equal(result.status, 'calorie_hold')
})

test('two-day mini-refeed requires complete logging and movement adherence', () => {
  const logs = Array.from({ length: 15 }, (_, i) => {
    const d = new Date('2026-01-01T12:00:00')
    d.setDate(d.getDate() + i)
    const date = d.toISOString().slice(0, 10)
    return { date, weight: 80, meals: [{ cals: 1800 }] }
  })
  const result = suggestRefeed({ logs, weeksIntoCut: 3, maintenance: 2400, currentWeight: 80, movementAdherence: 1 })
  assert.equal(result.kind, 'mini_refeed')
  assert.equal(result.durationDays, 2)
})
