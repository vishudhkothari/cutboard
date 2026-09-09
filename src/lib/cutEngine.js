/* ═══════════════════════════════════════════════════════════════
   CUT INTELLIGENCE ENGINE
   Pure functions — no React, no side effects. Unit-testable.

   Pipeline:
   1. trendWeight()      — EWMA smoothing of noisy daily weigh-ins
   2. estimateTDEE()     — rolling regression of intake vs trend change
   3. fatLossModel()     — splits lost mass into fat/lean via strength signal
   4. projectGoal()      — completion date + confidence band
   5. paceController()   — weekly recalibration: steps → cardio → calories
═══════════════════════════════════════════════════════════════ */

const MIN_CALS    = 1200          // physiological floor
const SAFE_RATE   = 0.0100        // max %BW/week before muscle risk climbs
const IDEAL_RATE  = 0.0070        // muscle-sparing sweet spot (%BW/week)
const NOISE_GAINING_RATE_KG = 0.05 // absolute scale-noise threshold, not a capacity threshold
const NOISE_STALLED_RATE_KG = 0.05 // absolute scale-noise threshold, not a capacity threshold
const REFEED_FLAT_RATE_KG = 0.15   // absolute plateau band; water noise is not proportional to body size
const PROTEIN_CONFIG = Object.freeze({ factor: 2.0, min: 110, max: 220 })
const EWMA_CONFIG = Object.freeze({ defaultAlpha: 0.10, acceleratedAlpha: 0.22, deviationThreshold: 1.25, consecutiveDays: 3, minResidualSamples: 5 })
const ENERGY_DENSITY_CONFIG = Object.freeze({ fat: 9400, lean: 1800, defaultFatFraction: 0.85 })
const DEFAULT_MAX_STEP_BUDGET = 14000
const MOVEMENT_HOLD_DAYS = 7
const CALORIE_HOLD_DAYS = 7
const LEANNESS_CONFIG = Object.freeze({ referenceHighBF: 25, minimumMultiplier: 0.75 })
// How many days of data before Cut IQ starts JUDGING (projection, pace,
// live TDEE). Shorter = faster feedback but noisier (water/glycogen).
// Single source so every Cut IQ surface stays in sync.
export const LEARN_DAYS = 7

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export function proteinTargetForWeight(weightKg, {
  factor = PROTEIN_CONFIG.factor,
  min = PROTEIN_CONFIG.min,
  max = PROTEIN_CONFIG.max,
} = {}) {
  const weight = Number(weightKg)
  const safeFactor = clamp(Number(factor) || PROTEIN_CONFIG.factor, 1.8, 2.2)
  if (!Number.isFinite(weight) || weight <= 0) return min
  return clamp(Math.round(weight * safeFactor), min, max)
}

export function compositeEnergyDensity(fatFraction = ENERGY_DENSITY_CONFIG.defaultFatFraction) {
  const f = clamp(Number.isFinite(+fatFraction) ? +fatFraction : ENERGY_DENSITY_CONFIG.defaultFatFraction, 0, 1)
  // A kg lost is a mixture of fat (~9,400 kcal/kg) and lean tissue (~1,800 kcal/kg).
  // Weighting those densities by the modeled fat fraction replaces the old fixed 7,700 assumption.
  return f * ENERGY_DENSITY_CONFIG.fat + (1 - f) * ENERGY_DENSITY_CONFIG.lean
}

export function tdeeConfidence({ coverage = 0, trendSpanDays = 0, dataPoints = 0 } = {}) {
  const coverageScore = clamp((coverage - 0.60) / 0.40, 0, 1)
  const spanScore = clamp((trendSpanDays - LEARN_DAYS) / 35, 0, 1)
  const pointScore = clamp((dataPoints - 5) / 13, 0, 1)
  // Confidence starts cautiously after the learning gate and rises only when
  // both intake coverage and trend history support the measured estimate.
  return clamp(0.10 + 0.45 * coverageScore + 0.30 * spanScore + 0.15 * pointScore, 0.10, 0.90)
}

export function leannessRateMultiplier(currentBF, goalBF, {
  referenceHighBF = LEANNESS_CONFIG.referenceHighBF,
  minimumMultiplier = LEANNESS_CONFIG.minimumMultiplier,
} = {}) {
  const current = Number(currentBF)
  const goal = Number(goalBF)
  if (!Number.isFinite(current) || !Number.isFinite(goal)) return 1
  if (current <= goal) return minimumMultiplier
  const span = Math.max(0.01, referenceHighBF - goal)
  const proximity = clamp((referenceHighBF - current) / span, 0, 1)
  return 1 - proximity * (1 - minimumMultiplier)
}

export function stepCeiling({ baselineStepAvg, userMaxStepBudget = DEFAULT_MAX_STEP_BUDGET } = {}) {
  const baseline = Math.max(0, Number(baselineStepAvg) || 0)
  const maxBudget = Math.max(0, Number(userMaxStepBudget) || DEFAULT_MAX_STEP_BUDGET)
  return Math.min(maxBudget, baseline + 4000)
}

export function isAdjustmentEligible(lastChangedAt, asOfDate, holdDays) {
  if (!lastChangedAt) return true
  const elapsed = _daySpan(lastChangedAt, asOfDate)
  return elapsed >= holdDays
}

/* local-date string helpers — all log keys are LOCAL 'YYYY-MM-DD' strings,
   so date math must stay in local time (toISOString would shift the day
   for anyone east of UTC) */
const _pad      = n => String(n).padStart(2, '0')
const _dateStr  = d => `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`
const _shiftDate = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return _dateStr(d) }
const _daySpan  = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)

/* ───────────────────────────────────────────────────────────────
   1. TREND WEIGHT  (adaptive Exponentially Weighted Moving Average)
   alpha 0.10 smooths normal water noise. After three consecutive calendar
   days of unusually directional residuals, alpha temporarily rises to 0.22
   so a genuine rapid change is not hidden behind filter lag.
─────────────────────────────────────────────────────────────── */
export function trendWeight(logs, alpha = EWMA_CONFIG.defaultAlpha) {
  const weighed = logs
    .filter(l => l.weight != null)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!weighed.length) return []
  let ewma = weighed[0].weight
  const residuals = []
  let directionalRun = 0
  let previousDirection = 0
  return weighed.map((l, index) => {
    if (index === 0) return { date: l.date, raw: l.weight, trend: Math.round(ewma * 100) / 100, alpha: 0 }

    const residual = l.weight - ewma
    const historical = residuals.slice()
    const mean = historical.length ? historical.reduce((sum, x) => sum + x, 0) / historical.length : 0
    const variance = historical.length ? historical.reduce((sum, x) => sum + (x - mean) ** 2, 0) / historical.length : 0
    const noiseSD = Math.sqrt(variance)
    const direction = Math.sign(residual)
    const isConsecutiveDay = _daySpan(weighed[index - 1].date, l.date) === 1
    const exceedsNoise = historical.length >= EWMA_CONFIG.minResidualSamples && Math.abs(residual - mean) > EWMA_CONFIG.deviationThreshold * noiseSD

    if (!isConsecutiveDay || direction === 0 || direction !== previousDirection || !exceedsNoise) directionalRun = 0
    directionalRun = exceedsNoise && isConsecutiveDay && direction === previousDirection ? directionalRun + 1 : (exceedsNoise && isConsecutiveDay ? 1 : directionalRun)
    previousDirection = direction

    const adaptiveAlpha = directionalRun >= EWMA_CONFIG.consecutiveDays ? EWMA_CONFIG.acceleratedAlpha : alpha
    ewma = adaptiveAlpha * l.weight + (1 - adaptiveAlpha) * ewma
    residuals.push(residual)
    return { date: l.date, raw: l.weight, trend: Math.round(ewma * 100) / 100, alpha: adaptiveAlpha }
  })
}

/* Latest smoothed trend weight (or null) */
export function currentTrendWeight(logs) {
  const t = trendWeight(logs)
  return t.length ? t[t.length - 1].trend : null
}

/* ───────────────────────────────────────────────────────────────
   2. ROLLING TDEE ESTIMATE
   Energy balance: ΔW = (intake − TDEE) / compositeDensity
   ⇒ TDEE ≈ avgIntake − (trendWeightChangePerDay × compositeDensity)
   (losing ⇒ ΔW negative ⇒ TDEE sits ABOVE intake)
   Uses a trailing window of CALENDAR days that have intake data.

   Fasting days are REAL low/zero-intake days and must feed the regression.
   A scheduled fasting weekday is only a plan. A day counts as fasting only
   when the user explicitly records l.fasting=true, so an unlogged plan never
   fabricates a zero-intake day or distorts the TDEE estimate.

   opts: { windowDays, fastingDays:[dow], fastComp:bool, fastKcal:number }
─────────────────────────────────────────────────────────────── */
export function estimateTDEE(logs, { windowDays = 18, fastComp = false, fastKcal = 0, fatFraction = ENERGY_DENSITY_CONFIG.defaultFatFraction } = {}) {
  const sorted = logs
    .filter(l => l.date)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!sorted.length) return null
  const trend = trendWeight(logs)
  const trendMap = Object.fromEntries(trend.map(t => [t.date, t.trend]))

  // window = last N CALENDAR days (slicing entries silently stretched the
  // window over a month when logging was sparse)
  const cutoff = _shiftDate(sorted[sorted.length - 1].date, -(windowDays - 1))
  const window = sorted.filter(l => l.date >= cutoff)

  // A scheduled fast is only a plan.  It must not change historical TDEE
  // accounting unless the user explicitly logged the fast as completed.
  const isFastDay = l => l.fasting === true
  // per-day intake: a fast day ate ~0 (full) or ~25% (compensation); every
  // other day is the sum of its logged meals
  const dayIntake = l => isFastDay(l)
    ? (fastComp ? fastKcal : 0)
    : (l.meals || []).reduce((m, x) => m + (+x.cals || 0), 0)

  // days with intake signal: meals logged, OR a (manual/scheduled) fast
  const withIntake = window.filter(l =>
    (Array.isArray(l.meals) && l.meals.length > 0) || isFastDay(l))
  if (withIntake.length < 5) return null   // not enough signal yet

  // trend-weight delta across the window span
  const firstDate = window.find(l => trendMap[l.date] != null)?.date
  const lastDate  = [...window].reverse().find(l => trendMap[l.date] != null)?.date
  if (!firstDate || !lastDate || firstDate === lastDate) return null

  // A handful of meal entries cannot support a calendar-day energy balance.
  // Previously five entries over an 18-day window were averaged as if they
  // represented every day, while the weight change still covered all 18
  // days. That could manufacture an implausibly high TDEE from sparse logs.
  const calendarDays = _daySpan(firstDate, lastDate) + 1
  const coverage = withIntake.length / calendarDays
  if (coverage < 0.60) return null

  const avgIntake = withIntake.reduce((s, l) => s + dayIntake(l), 0) / withIntake.length

  const wStart = trendMap[firstDate]
  const wEnd   = trendMap[lastDate]
  const spanDays = Math.max(1, _daySpan(firstDate, lastDate))
  const kgChangePerDay = (wEnd - wStart) / spanDays            // negative when losing
  const density = compositeEnergyDensity(fatFraction)
  const tdee = Math.round(avgIntake - kgChangePerDay * density)

  return {
    tdee,
    avgIntake: Math.round(avgIntake),
    weeklyRateKg: Math.round(kgChangePerDay * 7 * 100) / 100,  // kg/week (neg = loss)
    spanDays: Math.round(spanDays),
    dataPoints: withIntake.length,
    coverage: Math.round(coverage * 100) / 100,
    density: Math.round(density),
  }
}

/* ───────────────────────────────────────────────────────────────
   3. FAT-LOSS MODEL  (strength-modulated mass partitioning)
   Past week 2, lost mass is mostly fat IF strength is retained.
   strengthSignal: 'up' | 'same' | 'slight_down' | 'down' | null
   Returns the fraction of lost mass attributable to fat.
─────────────────────────────────────────────────────────────── */
export function fatFraction(strengthSignal, weekIntoCut) {
  // Week 1-2: heavy water/glycogen flux — composition meaningless
  if (weekIntoCut < 2) return null
  switch (strengthSignal) {
    case 'up':          return 0.95   // gaining strength while losing = almost all fat
    case 'same':        return 0.90   // textbook muscle-sparing cut
    case 'slight_down': return 0.78   // minor muscle leak — acceptable
    case 'down':        return 0.60   // burning real muscle — too aggressive
    default:            return 0.85   // no signal → evidence-based default
  }
}

export function evaluateMuscleRisk({ strengthReports = [], e1rmTrend = [] } = {}) {
  const reports = strengthReports
    .filter(r => r?.signal && r?.weekKey != null)
    .sort((a, b) => String(a.weekKey).localeCompare(String(b.weekKey)))
  const lastTwo = reports.slice(-2)
  const consecutiveDown = lastTwo.length === 2 && lastTwo.every(r => r.signal === 'down') &&
    String(lastTwo[1].weekKey) !== String(lastTwo[0].weekKey)

  const valid = e1rmTrend.filter(x => Number.isFinite(+x?.baseline) && Number.isFinite(+x?.current) && +x.baseline > 0)
  const objectiveDrop = valid.some(x => (+x.current / +x.baseline) <= 0.97)
  const confirmed = consecutiveDown || objectiveDrop
  return {
    confirmed,
    watch: !confirmed && (reports.at(-1)?.signal === 'down' || objectiveDrop),
    reason: consecutiveDown ? 'two_consecutive_down_reports' : objectiveDrop ? 'objective_e1rm_drop' : null,
  }
}

const PRIMARY_COMPOUNDS = new Set(['squat', 'front_squat', 'bench_press', 'deadlift', 'rdl', 'ohp', 'pull_up'])
const _e1rm = (weight, reps) => reps === 1 ? weight : weight * (1 + reps / 30)

export function objectiveE1rmTrend(workouts = [], asOfDate = null) {
  const dated = workouts.filter(w => w?.date && (!asOfDate || w.date <= asOfDate)).sort((a,b)=>a.date.localeCompare(b.date))
  if (!dated.length) return []
  const end = dated.at(-1).date
  const endDate = new Date(end + 'T12:00:00')
  const shift = days => { const d = new Date(endDate); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
  const recentStart = shift(-13)
  const priorStart = shift(-27)
  const byLift = {}
  for (const workout of dated) {
    const window = workout.date >= recentStart ? 'current' : workout.date >= priorStart ? 'baseline' : null
    if (!window) continue
    for (const exercise of workout.exercises || []) {
      if (!PRIMARY_COMPOUNDS.has(exercise.exerciseId)) continue
      const best = (exercise.sets || []).filter(s => s.done !== false && +s.weight > 0 && +s.reps > 0)
        .reduce((bestSet, s) => Math.max(bestSet, _e1rm(+s.weight, +s.reps)), 0)
      if (best > 0) byLift[exercise.exerciseId] ||= { baseline: [], current: [] }
      if (best > 0) byLift[exercise.exerciseId][window].push(best)
    }
  }
  return Object.entries(byLift)
    .filter(([, value]) => value.baseline.length && value.current.length)
    .map(([exerciseId, value]) => ({
      exerciseId,
      baseline: value.baseline.reduce((s, x) => s + x, 0) / value.baseline.length,
      current: value.current.reduce((s, x) => s + x, 0) / value.current.length,
    }))
}

/* Estimate current fat mass & BF% from an anchor + modelled fat loss.
   anchor = { date, weight, bf }  (your honest visual/Realme re-anchor)
   Re-anchors completely reset the model from that point. */
export function inferBodyComp({ logs, anchor, strengthSignal, startDate }) {
  const trend = trendWeight(logs)
  const trendNow = trend.length ? trend[trend.length - 1].trend : null
  if (!anchor || trendNow == null) return null

  const anchorTrend = (() => {
    // trend weight closest to (>=) anchor date
    const at = trend.find(x => x.date >= anchor.date) || trend[trend.length - 1]
    return at ? at.trend : anchor.weight
  })()

  const massLost = anchorTrend - trendNow            // kg lost since anchor (positive)
  // A re-anchor starts a new composition model. Use the latest observed
  // weigh-in as the model's as-of date so opening the app later cannot change
  // the result without new evidence.
  const modelStart = anchor.date || startDate
  const modelEnd = trend[trend.length - 1].date
  const weeksIn = modelStart && modelEnd
    ? Math.max(0, _daySpan(modelStart, modelEnd) / 7)
    : 0
  const ff       = fatFraction(strengthSignal, weeksIn) ?? 0.85

  const anchorFatMass = anchor.weight * (anchor.bf / 100)
  const fatLost       = Math.max(0, massLost) * ff
  const leanLost      = Math.max(0, massLost) * (1 - ff)
  const newFatMass    = Math.max(0, anchorFatMass - fatLost)
  const newBF         = trendNow > 0 ? (newFatMass / trendNow) * 100 : anchor.bf
  const leanMass      = Math.max(0, trendNow - newFatMass)

  return {
    bf: Math.round(newBF * 10) / 10,
    fatMass: Math.round(newFatMass * 10) / 10,
    fatLost: Math.round(fatLost * 100) / 100,
    leanLost: Math.round(leanLost * 100) / 100,
    leanMass: Math.round(leanMass * 10) / 10,
    massLost: Math.round(massLost * 100) / 100,
    fatFractionUsed: ff,
  }
}

/* ───────────────────────────────────────────────────────────────
   4. GOAL PROJECTION  (with confidence band)
   Projects when goal BF% is reached at current trend rate.
   Band derived from variance of recent weekly rates.
─────────────────────────────────────────────────────────────── */
export function projectGoal({ logs, currentBF, goalBF, currentWeight, leanMass }) {
  const trend = trendWeight(logs)
  // Need ~LEARN_DAYS of trend (and a few points) before projecting. Shorter
  // windows are water-contaminated and noisier — the trade-off for earlier
  // feedback. Counting entries alone let sparse logs through too early.
  const trendSpan = trend.length > 1
    ? _daySpan(trend[0].date, trend[trend.length - 1].date) + 1 : 0
  if (trend.length < 4 || trendSpan < LEARN_DAYS || !Number.isFinite(+currentBF)) return { early: true }

  // weekly rates between trend points ~RATE_MIN+ REAL days apart (array
  // indices are not days — a missed weigh-in must not inflate the rate).
  // The minimum delta scales with the window so a 7-day gate can still form
  // a rate, but never below ~4 days (too noisy to annualise).
  const RATE_MIN = Math.max(4, Math.min(7, LEARN_DAYS - 2))
  const rates = []
  for (let i = 1; i < trend.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      const span = _daySpan(trend[j].date, trend[i].date)
      if (span >= RATE_MIN) {
        if (span <= RATE_MIN + 5) rates.push({
          date: trend[i].date,
          rate: (trend[i].trend - trend[j].trend) / span * 7,   // kg/week
        })
        break
      }
    }
  }
  if (!rates.length) return null

  // rates from the trailing ~4 weeks
  const recentCut = _shiftDate(trend[trend.length - 1].date, -27)
  const recentArr = rates.filter(r => r.date >= recentCut).map(r => r.rate)
  const recent = recentArr.length ? recentArr : rates.slice(-4).map(r => r.rate)
  const meanRate = recent.reduce((s, x) => s + x, 0) / recent.length   // kg/week (neg)
  const variance = recent.reduce((s, x) => s + (x - meanRate) ** 2, 0) / recent.length
  const sd = Math.sqrt(variance)

  if (meanRate >= -NOISE_STALLED_RATE_KG) return { stalled: true, meanRateKg: Math.round(meanRate * 100) / 100 }

  // goal weight at goal BF, holding current lean mass
  const goalWeight = leanMass / (1 - goalBF / 100)
  const kgToGo     = currentWeight - goalWeight
  if (kgToGo <= 0) return { reached: true }

  // meanRate is negative: −sd is the FASTER edge, +sd the SLOWER edge.
  // If the slow edge is ~stalled the date is unbounded — cap at 2× mid.
  const fastEdge  = meanRate - sd
  const slowEdge  = meanRate + sd
  const weeksMid  = kgToGo / Math.abs(meanRate)
  const weeksFast = kgToGo / Math.abs(fastEdge)
  const weeksSlow = slowEdge <= -0.05
    ? Math.min(kgToGo / Math.abs(slowEdge), weeksMid * 2)
    : weeksMid * 2

  const addDays = w => { const d = new Date(); d.setDate(d.getDate() + Math.round(w * 7)); return d }
  return {
    stalled: false,
    kgToGo: Math.round(kgToGo * 10) / 10,
    goalWeight: Math.round(goalWeight * 10) / 10,
    meanRateKg: Math.round(meanRate * 100) / 100,
    weeksMid: Math.round(weeksMid * 10) / 10,
    dateMid:  addDays(weeksMid),
    dateFast: addDays(Math.min(weeksFast, weeksMid)),
    dateSlow: addDays(Math.max(weeksSlow, weeksMid)),
  }
}

/* ───────────────────────────────────────────────────────────────
   5. PACE CONTROLLER  (goal-driven, adaptive, muscle-sparing)
   Back-calculates required rate from goal + days left, compares to
   actual trend rate, and prescribes the next lever:
   steps → Zone 2 cardio → calories (in that order).
─────────────────────────────────────────────────────────────── */
export function paceController({
  currentWeight, currentBF, goalBF, leanMass,
  daysLeft, actualWeeklyRateKg, currentSteps = 10000,
  baselineSteps = 10000,
  baselineStepAvg = baselineSteps,
  userMaxStepBudget = DEFAULT_MAX_STEP_BUDGET,
  currentCardioMin = 0, strengthSignal,
  muscleRisk = null,
  dataDays = 0,           // # of logged days with usable data
  hasRate = false,        // whether actualWeeklyRateKg is a real measurement (not a 0 placeholder)
  recentAvgSteps = null,
  recentStepDays = 0,
  zone2CompletedSessions = 0,
  requiredZone2Sessions = 0,
  stepAdjustmentEligible = true,
  calorieAdjustmentEligible = true,
  calorieCooldownDays = CALORIE_HOLD_DAYS,
}) {
  const goalWeight   = leanMass / (1 - goalBF / 100)
  const kgToGo       = currentWeight - goalWeight
  const weeksLeft    = Math.max(1, daysLeft / 7)
  const requiredRate = kgToGo / weeksLeft                       // kg/week needed
  const requiredPct  = requiredRate / currentWeight             // %BW/week needed
  // actualWeeklyRateKg is NEGATIVE when losing. Flip so positive = losing;
  // a NEGATIVE lossRate means the trend is going UP (never abs() this away —
  // weight regain is the most important signal a cut coach can catch).
  const lossRate     = -(actualWeeklyRateKg || 0)
  const actualRate   = Math.max(0, lossRate)                    // kg/week actual loss

  const rateMultiplier = leannessRateMultiplier(currentBF, goalBF)
  const safeRateKg  = currentWeight * SAFE_RATE * rateMultiplier
  const idealRateKg = currentWeight * IDEAL_RATE * rateMultiplier

  // ── COLD START: don't recommend anything until we've actually learned ──
  // Needs ~LEARN_DAYS logged days AND a real measured rate before judging
  // pace — early trend weight is dominated by glycogen/water, so judging
  // "stalled" before then is unreliable (shorter window = faster but noisier).
  if (!hasRate || dataDays < LEARN_DAYS) {
    const daysToGo = Math.max(0, LEARN_DAYS - dataDays)
    return {
      status: 'learning',
      headline: dataDays === 0 ? 'Just getting started' : `Learning your body — ${daysToGo} more day${daysToGo === 1 ? '' : 's'} of data`,
      actions: [
        'Log your weight daily and your meals — that\'s all for now.',
        'I won\'t judge your pace until I\'ve learned your real loss rate (about a week).',
        'Early weight swings are mostly water and glycogen, so trust them less at first.',
      ],
      cardioRx: null,
      recommendedSteps: currentSteps,
      requiredRateKg: Math.round(requiredRate * 100) / 100,
      requiredPct: Math.round(requiredPct * 1000) / 10,
      actualRateKg: hasRate ? Math.round(lossRate * 100) / 100 : null,
      safeRateKg: Math.round(safeRateKg * 100) / 100,
      idealRateKg: Math.round(idealRateKg * 100) / 100,
      goalTooAggressive: daysLeft > 0 && requiredPct > SAFE_RATE * rateMultiplier,
      goalWeight: Math.round(goalWeight * 10) / 10,
      kgToGo: Math.round(kgToGo * 10) / 10,
      learning: true,
    }
  }

  const stats = {
    requiredRateKg: Math.round(requiredRate * 100) / 100,
    requiredPct: Math.round(requiredPct * 1000) / 10,
    actualRateKg: Math.round(lossRate * 100) / 100,
    safeRateKg: Math.round(safeRateKg * 100) / 100,
    idealRateKg: Math.round(idealRateKg * 100) / 100,
    goalWeight: Math.round(goalWeight * 10) / 10,
    kgToGo: Math.round(kgToGo * 10) / 10,
  }

  // ── GOAL REACHED: no levers to pull, shift to maintenance ──
  if (kgToGo <= 0) {
    return {
      status: 'reached',
      headline: 'Goal weight reached — shift to maintenance',
      actions: [
        'You\'re at (or past) your goal weight. The cut is done.',
        'Reverse out slowly: add ~150–200 kcal/week until trend weight holds steady.',
        `Keep protein at ${proteinTargetForWeight(currentWeight)}g and keep lifting — that locks the result in.`,
      ],
      cardioRx: null,
      recommendedSteps: baselineSteps,
      goalTooAggressive: false,
      ...stats,
    }
  }

  // ── CLASSIFY against the HEALTHY rate band, not the aggressive goal ──
  // A cut is "working" if you're losing at a sustainable, muscle-sparing
  // rate (roughly ideal..safe). Whether that pace also hits an aggressive
  // calendar goal is a SEPARATE question (goalTooAggressive note below).
  // (Past the 60-day window daysLeft pins at 1 and requiredPct explodes —
  // suppress the aggressive-goal note when under a week remains.)
  const goalTooAggressive = daysLeft > 0 && requiredPct > SAFE_RATE * rateMultiplier
  const losingMuscle = muscleRisk ? !!muscleRisk.confirmed : strengthSignal === 'down'
  const gaining      = lossRate < -NOISE_GAINING_RATE_KG // absolute scale-noise threshold
  const maxStepGoal  = stepCeiling({ baselineStepAvg, userMaxStepBudget })
  const nextStepGoal = Math.min(currentSteps + 2000, maxStepGoal)
  const lowerStepGoal = Math.max(baselineSteps, currentSteps - 1000)

  // healthy band: from a gentle floor (~60% of ideal) up to the safe ceiling
  const healthyFloor = idealRateKg * 0.6
  const onTrack  = actualRate >= healthyFloor && actualRate <= safeRateKg * 1.1
  const tooFast  = actualRate > safeRateKg * 1.1
  // only "too slow" if losing meaningfully less than a healthy minimum
  const tooSlow  = actualRate < healthyFloor
  // A healthy rate can still miss the user's chosen cut deadline. Movement is
  // still the next useful lever when there is room below the step ceiling;
  // goalTooAggressive remains a warning that movement alone cannot safely
  // guarantee the requested date.
  const behindSchedule = requiredRate > actualRate + 0.02
  const scheduleNeedsMovement = behindSchedule && currentSteps < maxStepGoal

  // Never escalate a movement prescription from a target the user has not
  // actually demonstrated.  This prevents the controller from treating an
  // uncompleted 14k target as evidence that 16k is needed.
  const movementNeedsProof = !losingMuscle && !tooFast && (gaining || tooSlow || scheduleNeedsMovement) && (
    recentStepDays < 5 || recentAvgSteps == null || recentAvgSteps < currentSteps * 0.95
  )
  const cardioNeedsProof = !losingMuscle && !tooFast && currentCardioMin > 0 && requiredZone2Sessions > 0 &&
    zone2CompletedSessions < requiredZone2Sessions
  if (movementNeedsProof || cardioNeedsProof) {
    return {
      status: 'movement_adherence',
      headline: movementNeedsProof ? 'Complete the current step target before increasing it' : 'Complete the current Zone 2 plan before adding more',
      actions: movementNeedsProof
        ? [`Your recent average is ${recentAvgSteps == null ? 'not available' : Math.round(recentAvgSteps).toLocaleString()} steps across ${recentStepDays} logged day${recentStepDays === 1 ? '' : 's'}.`, `Hold ${currentSteps.toLocaleString()} steps/day and log at least 5 days before changing the prescription.`, 'Unfinished movement cannot be used as evidence that calories need to fall.']
        : [`You have logged ${zone2CompletedSessions} of ${requiredZone2Sessions} planned Zone 2 session${requiredZone2Sessions === 1 ? '' : 's'} this week.`, 'Complete the current sessions before adding more cardio or reducing calories.', 'Log each session in Today so the next recommendation reflects what actually happened.'],
      cardioRx: null,
      recommendedSteps: currentSteps,
      muscleWatch: !!muscleRisk?.watch,
      goalTooAggressive,
      ...stats,
    }
  }

  // Confirmed muscle risk outranks movement cooldown: strength loss is the
  // more consequential signal and must not be hidden for a review week.
  if (losingMuscle) {
    return {
      status: 'muscle_risk',
      headline: 'Strength is dropping - ease the deficit',
      actions: [
        'Your lifts are falling, which signals muscle loss. Pull back, don\'t push harder.',
        'Add 100-150 kcal back (carbs around training) and hold for a week.',
        'Keep protein dynamic, prioritise sleep 7.5h+.',
      ],
      cardioRx: null,
      recommendedSteps: currentSteps,
      muscleWatch: !!muscleRisk?.watch,
      goalTooAggressive,
      ...stats,
    }
  }

  const stepChangeNeeded = gaining || tooSlow || scheduleNeedsMovement || (onTrack && currentSteps > baselineSteps)
  if (stepChangeNeeded && !stepAdjustmentEligible) {
    return {
      status: 'movement_hold',
      headline: 'Hold this movement target for 7 days',
      actions: ['Movement targets are reviewed weekly so the plan cannot ratchet up day after day.', `Keep ${currentSteps.toLocaleString()} steps/day until the review window is complete.`, 'Calories remain unchanged while this target is being tested.'],
      cardioRx: null,
      recommendedSteps: currentSteps,
      goalTooAggressive,
      ...stats,
    }
  }

  let status, headline, actions = [], cardioRx = null

  if (losingMuscle) {
    status = 'muscle_risk'
    headline = 'Strength is dropping — ease the deficit'
    actions = [
      'Your lifts are falling, which signals muscle loss. Pull back, don\'t push harder.',
      'Add 100–150 kcal back (carbs around training) and hold for a week.',
      `Keep protein at ${proteinTargetForWeight(currentWeight)}g, prioritise sleep 7.5h+.`,
    ]
  } else if (gaining) {
    if (currentSteps < maxStepGoal) {
      status = 'lever_steps'
      headline = `Trend is rising ${Math.abs(lossRate).toFixed(2)} kg/wk — increase steps first`
      actions = [
        'Your smoothed trend is going up, so the deficit is not real right now.',
        `Raise the daily step goal to ${nextStepGoal.toLocaleString()} (from ${currentSteps.toLocaleString()}) and hold it for 7 days.`,
        'Audit logging too: untracked oils, sauces and bites are common causes.',
      ]
    } else if (currentCardioMin < 90) {
      status = 'lever_cardio'
      headline = 'Trend is rising — add Zone 2 before cutting food'
      const addMin = currentCardioMin === 0 ? 40 : currentCardioMin < 60 ? 60 : 90
      const sessions = addMin <= 40 ? '2×20 min' : addMin <= 60 ? '2×30 min' : '3×30 min'
      cardioRx = {
        weeklyMin: addMin, sessions, sessionsPerWeek: addMin <= 60 ? 2 : 3, minutesPerSession: addMin <= 60 ? Math.round(addMin / 2) : 30,
        intensity: 'Zone 2 (can hold a conversation, ~60-70% max HR)',
        when: 'Rest days or AFTER lifting — never before leg day',
        what: 'Incline walk, cycling, or elliptical. Keep it boring and easy.',
      }
      actions = [
        'Your smoothed trend is going up, so the deficit is not real right now.',
        `Keep ${currentSteps.toLocaleString()} steps and add ${sessions} of Zone 2 cardio.`,
        'Only reduce calories after logging and movement have been consistent for 7 days.',
      ]
    } else {
      status = 'lever_calories'
      headline = 'Movement is maxed — trim calories last'
      actions = [
        'Your smoothed trend is going up despite the movement plan.',
        'Audit logging carefully, then trim ~150 kcal from the daily target.',
        `Keep protein at ${proteinTargetForWeight(currentWeight)}g and reassess after 7 days.`,
      ]
    }
  } else if (tooFast) {
    status = 'too_fast'
    headline = `Losing ${actualRate.toFixed(2)} kg/wk — faster than safe`
    actions = [
      `You're above the muscle-sparing ceiling (~${safeRateKg.toFixed(2)} kg/wk).`,
      'Add ~150 kcal back to protect lean mass and adherence.',
      'Fast loss now = rebound risk later. Slow is durable.',
    ]
  } else if (onTrack) {
    status = 'on_track'
    headline = `On track — losing ${actualRate.toFixed(2)} kg/wk`
    actions = [
      'You\'re losing at a healthy, muscle-sparing rate.',
      goalTooAggressive
        ? scheduleNeedsMovement
          ? `Raise the step goal to ${nextStepGoal.toLocaleString()}/day to improve the trend, but the selected deadline still requires an unsafe rate. Do not push beyond ${maxStepGoal.toLocaleString()} steps to chase it.`
          : 'Your selected deadline requires an unsafe rate. Keep the healthy pace instead of pushing beyond the movement ceiling.'
        : currentSteps > baselineSteps
        ? `Reduce the step goal to ${lowerStepGoal.toLocaleString()} and hold it for 7 days; food stays unchanged.`
        : 'Hold the current movement and calorie plan.',
      'Trend weight is moving the right way — consistency is doing its job.',
    ]
  } else if (tooSlow) {
    status = 'too_slow'
    // LEVER ORDER: steps → Zone 2 → calories
    if (currentSteps < maxStepGoal) {
      const newSteps = nextStepGoal
      status = 'lever_steps'
      headline = 'Stalled — bump daily steps first'
      actions = [
        `Raise step goal to ${newSteps.toLocaleString()}/day (was ${currentSteps.toLocaleString()}).`,
        'Cheapest lever — burns fat without touching recovery or food.',
        'Give it 7 days before changing anything else.',
      ]
    } else if (currentCardioMin < 90) {
      const addMin = currentCardioMin === 0 ? 40 : currentCardioMin < 60 ? 60 : 90
      const sessions = addMin <= 40 ? '2×20 min' : addMin <= 60 ? '2×30 min' : '3×30 min'
      status = 'lever_cardio'
      headline = 'Still stalled — add Zone 2 cardio'
      cardioRx = {
        weeklyMin: addMin, sessions, sessionsPerWeek: addMin <= 60 ? 2 : 3, minutesPerSession: addMin <= 60 ? Math.round(addMin / 2) : 30,
        intensity: 'Zone 2 (can hold a conversation, ~60-70% max HR)',
        when: 'Rest days or AFTER lifting — never before leg day',
        what: 'Incline walk, cycling, or elliptical. Keep it boring and easy.',
      }
      actions = [
        `Add ${sessions} of Zone 2 cardio (${addMin} min/week total).`,
        'Zone 2 burns fat while sparing recovery — unlike HIIT on a cut.',
        'Schedule after lifts or on rest days. Steps stay where they are.',
      ]
    } else {
      status = 'lever_calories'
      headline = 'Steps & cardio maxed — trim calories last'
      actions = [
        'You\'ve maxed movement. Now cut ~150 kcal from the daily target.',
        `Take it from carbs on rest days, keep protein at ${proteinTargetForWeight(currentWeight)}g.`,
        'This is the last lever for a reason — protect food as long as possible.',
      ]
    }
  } else {
    status = 'on_track'
    headline = 'Holding steady'
    actions = ['Stay the course and keep logging.']
  }

  if ((status === 'too_fast' || status === 'lever_calories') && !calorieAdjustmentEligible) {
    status = 'calorie_hold'
    headline = 'Hold the calorie target for the review window'
    actions = [
      `A calorie change was made recently; hold it for ${calorieCooldownDays} days before changing food again.`,
      'Keep logging weight, meals, movement, and training so the next decision uses a complete response window.',
    ]
    cardioRx = null
  }

  const recommendedSteps = status === 'lever_steps'
    ? nextStepGoal
    : status === 'on_track'
      ? (scheduleNeedsMovement ? nextStepGoal : lowerStepGoal)
      : currentSteps
  return { status, headline, actions, cardioRx, recommendedSteps, muscleWatch: !!muscleRisk?.watch, goalTooAggressive, ...stats }
}


/* ───────────────────────────────────────────────────────────────
   5b. REFEED / DIET-BREAK ADVISOR
   A genuine plateau (flat trend despite adherence) 4+ weeks into a
   cut is often adaptive: lowered NEAT, cortisol water retention,
   leptin drop. A structured refeed (1 day at maintenance, carbs up)
   or a full diet break (1 week at maintenance, 8+ weeks in) is the
   evidence-based reset. Returns null when not warranted.
─────────────────────────────────────────────────────────────── */
export function suggestRefeed({ logs, weeksIntoCut, maintenance, targetCalories = null, currentWeight = null, proteinFactor = PROTEIN_CONFIG.factor, movementAdherence = null }) {
  const trend = trendWeight(logs)
  if (trend.length < 10) return null

  // rate over the trailing ~14 days
  const last = trend[trend.length - 1]
  const cutoffDate = _shiftDate(last.date, -14)
  const past = trend.filter(t => t.date <= cutoffDate)
  if (!past.length) return null
  const ref = past[past.length - 1]
  const days = _daySpan(ref.date, last.date)
  if (days < 10) return null
  const rate = (last.trend - ref.trend) / days * 7   // kg/week

  // A flat scale trend is not a genuine plateau when intake is consistently
  // above plan, and sparse food logs cannot establish adherence. Refeed only
  // when at least 10 of the trailing 15 calendar days have intake data and
  // the logged average is reasonably close to the plan.
  const adherenceWindow = logs.filter(l => l.date >= cutoffDate && l.date <= last.date && l.meals?.length)
  const calendarDays = Math.max(1, _daySpan(cutoffDate, last.date) + 1)
  const mealCoverage = adherenceWindow.length / calendarDays
  if (weeksIntoCut * 7 >= 14 && mealCoverage >= 0.95 && movementAdherence === 1 && rate >= -0.05 && rate <= 0.05) {
    const protein = proteinTargetForWeight(currentWeight, { factor: proteinFactor })
    return {
      kind: 'mini_refeed', durationDays: 2,
      headline: 'High-confidence plateau — take a 2-day mini-refeed',
      reason: `Your trend is flat (~${Math.abs(rate).toFixed(2)} kg/wk) across a fully logged, fully adherent 14-day window.`,
      protocol: [
        `Eat at estimated maintenance (~${Math.round(maintenance)} kcal) for two days.`,
        `Keep protein at ${protein}g and place most additional calories into carbohydrates.`,
        'Return to the normal target on day three; this does not override a higher-priority recovery or safety signal.',
      ],
    }
  }

  const span = _daySpan(trend[0].date, trend[trend.length - 1].date) + 1
  if (weeksIntoCut < 4 || span < 28) return null                       // need a month of context
  if (mealCoverage < 10 / 15) return null
  const fallbackTarget = Math.max(MIN_CALS, maintenance - 600)
  const avgTarget = adherenceWindow.reduce((sum, l) => sum + (l.planSnapshot?.eatTarget ?? targetCalories ?? fallbackTarget), 0) / adherenceWindow.length
  const avgIntake = adherenceWindow.reduce((sum, l) => sum + l.meals.reduce((day, meal) => day + (+meal.cals || 0), 0), 0) / adherenceWindow.length
  if (avgIntake > avgTarget + 150) return null

  // only a TRUE plateau qualifies: not losing, but not gaining either —
  // gaining means intake, not adaptation, and the pace coach handles that
  if (rate <= -REFEED_FLAT_RATE_KG || rate >= REFEED_FLAT_RATE_KG) return null

  if (weeksIntoCut >= 8) {
    return {
      kind: 'break',
      headline: 'Stalled 2+ weeks, 8+ weeks deep — take a diet break',
      reason: `Trend has been flat (~${Math.abs(rate).toFixed(2)} kg/wk) for two weeks after ${Math.floor(weeksIntoCut)} weeks of dieting. That pattern usually means metabolic adaptation, not failure.`,
      protocol: [
        `Eat at maintenance (~${Math.round(maintenance)} kcal) for ONE FULL WEEK. This is a reset, not a cheat.`,
        `Keep protein at ${proteinTargetForWeight(currentWeight, { factor: proteinFactor })}g and keep training — most of the scale jump will be water/glycogen.`,
        'After the week, resume the deficit. Loss typically restarts faster than before.',
      ],
    }
  }
  return {
    kind: 'refeed',
    headline: 'Genuine plateau — schedule a refeed day',
    reason: `Trend has been flat (~${Math.abs(rate).toFixed(2)} kg/wk) for two weeks while you've been in a deficit. A planned high-carb day can reset hormones and training quality.`,
    protocol: [
      `Pick ONE day (ideally a hard training day): eat at maintenance (~${Math.round(maintenance)} kcal).`,
      `Put the extra calories almost entirely into CARBS — keep protein at ${proteinTargetForWeight(currentWeight, { factor: proteinFactor })}g, fat stays low.`,
      'Expect +0.5–1 kg of water next morning; it clears in 2–3 days. Back to the normal target the next day.',
    ],
  }
}

/* ───────────────────────────────────────────────────────────────
   6. UNIFIED TARGET RESOLVER  ★ SINGLE SOURCE OF TRUTH ★
   Every tab calls this. Given the user's regime + live model state,
   returns the canonical daily calorie target and macro split.

   Priority chain:
   1. Fasting day  → 0 or 25% compensation
   2. Cut IQ live target (model-driven base, auto-applied)
   3. Regime distribution: 'steady' = flat, 'zigzag' = weekly wave
   Protein is dynamically calculated from current body mass; remaining kcal
   split 50/50 carb/fat.

   params:
     baseTarget   — Cut IQ recommended daily target (or adaptiveTDEE.target fallback)
     tdeeBase     — maintenance TDEE (for zigzag wave math)
     regime       — 'steady' | 'zigzag'
     zigzag       — { schedule, mode }
     fasting      — { isFasting, compensation }  (compensation = 25% if true)
     dateObj      — Date to resolve for (defaults today)
─────────────────────────────────────────────────────────────── */
const _DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

/* Zigzag as a bounded % swing AROUND the daily cut target.
   High days +15%, low days −12% — the pattern's mean is ~0 so the
   weekly average stays at target. Sustainable, never floors out.
   schedule 1: high on weekends (Sat/Sun)
   schedule 2: wave — high mid-week (Wed), low at week edges        */
const _ZZ_HIGH = 0.15   // +15% on high days
const _ZZ_LOW  = -0.12  // −12% on low days
// pattern multipliers per weekday (Sun..Sat), chosen so the 7-day mean ≈ 0
const _ZZ_PATTERN = {
  1: [ 0.15, -0.12, -0.12, -0.06, -0.12, -0.12, 0.15 ],  // weekends high
  2: [ -0.12, -0.06, 0.06, 0.15, 0.06, -0.06, -0.12 ],   // wave, peaks Wed
}

/* weekly zigzag distribution (Sun–Sat) as eat-targets around `target`.
   The pattern is auto-centered so the 7-day mean equals `target` exactly,
   keeping the weekly deficit identical to steady mode. */
export function zigzagWeek(target, schedule = 1, intensity = 'weight', floor = MIN_CALS, dateObj = new Date()) {
  const ampScale = intensity === 'mild' ? 0.6 : intensity === 'extreme' ? 1.5 : 1
  const pattern = _ZZ_PATTERN[schedule] || _ZZ_PATTERN[1]
  const patMean = pattern.reduce((s, x) => s + x, 0) / 7   // center the pattern
  const todayDow = dateObj.getDay()
  return _DAYS.map((name, dow) => {
    const pct = (pattern[dow] - patMean) * ampScale
    const cals = Math.max(floor, Math.round(target * (1 + pct)))
    return { name, cals, isToday: todayDow === dow }
  })
}

export function macrosFromCalories(calTarget, proteinG = PROTEIN_CONFIG.min, currentWeightKg = null, proteinOptions = {}) {
  const targetProteinG = currentWeightKg != null
    ? proteinTargetForWeight(currentWeightKg, proteinOptions)
    : proteinG
  // on tiny targets (25% fast compensation) cap protein at 60% of the day
  // so the macro grams can never sum past the calorie target
  const p = Math.min(targetProteinG, Math.floor(calTarget * 0.6 / 4))
  const remaining = Math.max(calTarget - p * 4, 0)
  return {
    calTarget,
    proteinG: p,
    proteinTargetG: targetProteinG,
    carbG: Math.round(remaining * 0.5 / 4),
    fatG:  Math.round(remaining * 0.5 / 9),
    // fibre: evidence-based ~14g per 1000 kcal, floored at 15g
    fiberG: calTarget > 0 ? Math.max(15, Math.round(calTarget * 14 / 1000)) : 0,
  }
}

/* ───────────────────────────────────────────────────────────────
   ★★★ buildDayPlan — THE SINGLE SOURCE OF TRUTH ★★★
   Called ONCE at App root. Every tab reads this object, none recompute.

   Returns a complete, self-consistent plan:
   {
     eatTarget      — the ONE number: kcal to eat today
     proteinG/carbG/fatG — macros for eatTarget
     maintenance    — maintenance TDEE (for deficit display)
     deficit        — maintenance - eatTarget (today's actual deficit)
     baseTarget     — the steady daily target (Cut IQ / formula driven)
     regime         — 'steady' | 'zigzag'
     fasting        — { isFasting, compensation, kind }
     week           — [{name, dow, eat, isToday, isFast}] the FULL shifted week
                      (zigzag varies but week mean === baseTarget)
   }

   params:
     baseTarget   — Cut IQ recommended daily target (or formula fallback)
     maintenance  — maintenance TDEE
     regime       — 'steady' | 'zigzag'
     zigzag       — { schedule, mode }
     fastingDays  — array of weekday indexes (0=Sun) that are fasting days
     fastComp     — bool: 25% compensation on fast days vs full fast
     manualFastToday / overriddenToday — manual fast toggles for today only
     dateObj      — defaults today
─────────────────────────────────────────────────────────────── */
export function buildDayPlan({
  baseTarget, maintenance, floor = MIN_CALS, regime = 'steady',
  zigzag = { schedule: 1, mode: 'weight' },
  fastingDays = [], fastComp = false,
  manualFastToday = false, overriddenToday = false,
  currentWeightKg = null, proteinFactor = PROTEIN_CONFIG.factor,
  dateObj = new Date(),
}) {
  const todayDow = dateObj.getDay()
  const floorCals = Math.max(MIN_CALS, Math.round(floor))

  // --- compute the weekly eat-targets (zigzag) or flat (steady) ---
  // This is the ONLY place zigzag math happens. zigzagWeek swings around
  // the cut TARGET (mean === target), and never drops below the floor.
  let weekEat            // array[7] of kcal to eat each weekday (pre-fasting)
  if (regime === 'zigzag') {
    const raw = zigzagWeek(baseTarget, zigzag.schedule, zigzag.mode, floorCals, dateObj)
    weekEat = raw.map(d => d.cals)
  } else {
    const flat = Math.max(floorCals, Math.round(baseTarget))
    weekEat = Array(7).fill(flat)
  }

  // --- apply fasting per day to build the displayed week ---
  const isFastDow = dow => fastingDays.includes(dow)
  const week = weekEat.map((eat, dow) => {
    const fast = isFastDow(dow)
    const dayEat = fast ? (fastComp ? Math.round(eat * 0.25) : 0) : eat
    return {
      name: _DAYS[dow], dow,
      eat: dayEat,
      baseEat: eat,            // what they'd eat if not fasting
      isToday: dow === todayDow,
      isFast: fast,
    }
  })

  // --- resolve TODAY (manual fast toggle can override the schedule) ---
  const plannedFastToday = isFastDow(todayDow) && !overriddenToday
  const isFasting = manualFastToday || plannedFastToday
  const baseEatToday = weekEat[todayDow]
  let eatTarget, fastKind = null
  if (isFasting) {
    if (fastComp) { eatTarget = Math.round(baseEatToday * 0.25); fastKind = 'comp25' }
    else          { eatTarget = 0; fastKind = 'full' }
  } else {
    eatTarget = baseEatToday
  }

  const macros  = eatTarget > 0 ? macrosFromCalories(eatTarget, null, currentWeightKg, { factor: proteinFactor }) : { calTarget: 0, proteinG: 0, proteinTargetG: 0, carbG: 0, fatG: 0, fiberG: 0 }
  const deficit = Math.round(maintenance - eatTarget)

  return {
    eatTarget,
    ...macros,
    maintenance: Math.round(maintenance),
    deficit,
    baseTarget: Math.round(baseTarget),
    baseEatToday,
    regime,
    fasting: { isFasting, compensation: fastComp, kind: fastKind, planned: plannedFastToday },
    week,
  }
}

export const ENGINE_CONST = {
  MIN_CALS, SAFE_RATE, IDEAL_RATE,
  NOISE_GAINING_RATE_KG, NOISE_STALLED_RATE_KG, REFEED_FLAT_RATE_KG,
  PROTEIN_CONFIG, EWMA_CONFIG, ENERGY_DENSITY_CONFIG,
  DEFAULT_MAX_STEP_BUDGET, MOVEMENT_HOLD_DAYS, CALORIE_HOLD_DAYS,
  LEANNESS_CONFIG,
}
