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

const MIN_CALS    = 1200          // product guardrail, not a universal physiological floor
const SAFE_RATE   = 0.0075        // conservative product ceiling (%BW/week)
const IDEAL_RATE  = 0.0050        // moderate planning rate (%BW/week)
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
export const LEARN_DAYS = 14

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
  if (currentBF == null || goalBF == null || !Number.isFinite(current) || !Number.isFinite(goal)) return 1
  if (current <= goal) return minimumMultiplier
  const span = Math.max(0.01, referenceHighBF - goal)
  const proximity = clamp((referenceHighBF - current) / span, 0, 1)
  return 1 - proximity * (1 - minimumMultiplier)
}

export function stepCeiling({ baselineStepAvg, userMaxStepBudget = DEFAULT_MAX_STEP_BUDGET } = {}) {
  const baseline = Math.max(0, Number(baselineStepAvg) || 0)
  const maxBudget = Math.max(0, Number(userMaxStepBudget) || DEFAULT_MAX_STEP_BUDGET)
  return Math.floor(Math.min(maxBudget, baseline + 4000) / 100) * 100
}

export function normalizeStepTarget(value, fallback = 10000) {
  const raw = Number(value)
  const safe = Number.isFinite(raw) && raw > 0 ? raw : fallback
  return Math.max(1000, Math.round(safe / 100) * 100)
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
    .filter(l => l.weight != null && l.weight !== '' && Number.isFinite(+l.weight) && +l.weight >= 35 && +l.weight <= 350)
    .map(l => ({ ...l, weight:+l.weight }))
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

// Complete, aligned intake/activity and robust weigh-ins are required for calibration.
export function estimateTDEE(logs, {windowDays=28,fatFraction=ENERGY_DENSITY_CONFIG.defaultFatFraction,activityForLog=()=>0}={}) {
  const sorted=[...new Map(logs.filter(l=>l?.date).map(l=>[l.date,l])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  if(!sorted.length)return null;
  const window=sorted.filter(l=>l.date>=_shiftDate(sorted.at(-1).date,-(windowDays-1)));
  let weighed=window.filter(l=>l.weight!=null&&l.weight!==''&&Number.isFinite(+l.weight)&&+l.weight>=35&&+l.weight<=350);
  if(weighed.length<8)return null;
  const median=values=>{const a=[...values].sort((a,b)=>a-b);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2};
  const origin=weighed[0].date;
  const points=weighed.map(l=>({x:_daySpan(origin,l.date),y:+l.weight,log:l}));
  const slopes=[];
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)if(points[j].x-points[i].x>=7)slopes.push((points[j].y-points[i].y)/(points[j].x-points[i].x));
  if(!slopes.length)return null;
  const robustSlope=median(slopes);
  const intercept=median(points.map(p=>p.y-robustSlope*p.x));
  const residuals=points.map(p=>p.y-(intercept+robustSlope*p.x));
  const residualCenter=median(residuals);
  const mad=median(residuals.map(r=>Math.abs(r-residualCenter)));
  const filtered=points.filter((p,i)=>Math.abs(residuals[i]-residualCenter)<=Math.max(.75,3*1.4826*mad));
  if(filtered.length<8||filtered.length<points.length*.75)return null;
  weighed=filtered.map(p=>p.log);
  const first=weighed[0].date,last=weighed.at(-1).date,spanDays=_daySpan(first,last);
  if(spanDays<14||_daySpan(last,window.at(-1).date)>3)return null;
  const mx=filtered.reduce((s,p)=>s+p.x,0)/filtered.length,my=filtered.reduce((s,p)=>s+p.y,0)/filtered.length;
  const slope=filtered.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0)/filtered.reduce((s,p)=>s+(p.x-mx)**2,0);
  const error=Math.sqrt(filtered.reduce((s,p)=>s+(p.y-(my+slope*(p.x-mx)))**2,0)/filtered.length);
  if(error>Math.max(.35,my*.008)||Math.abs(slope*7)>my*.015)return null;
  const byDate=new Map(window.map(l=>[l.date,l]));
  const interval=Array.from({length:spanDays},(_,i)=>byDate.get(_shiftDate(first,i)));
  if(interval.some(l=>!l||l.foodComplete!==true||l.activityComplete!==true||!Array.isArray(l.meals)||!Number.isFinite(activityForLog(l))||l.meals.some(m=>m.cals==null||m.cals===''||!Number.isFinite(+m.cals)||+m.cals<0)))return null;
  const intake=l=>l.meals.reduce((s,m)=>s + +m.cals,0);
  const avgIntake=interval.reduce((s,l)=>s+intake(l),0)/spanDays;
  if(avgIntake<1000)return null;
  const normalizedIntake=interval.reduce((s,l)=>s+intake(l)-activityForLog(l),0)/spanDays;
  const density=compositeEnergyDensity(fatFraction);
  return {tdee:Math.round(normalizedIntake-slope*density),avgIntake:Math.round(avgIntake),normalizedIntake:Math.round(normalizedIntake),weeklyRateKg:Math.round(slope*700)/100,spanDays,dataPoints:interval.length,coverage:1,density:Math.round(density),firstDate:first,lastDate:last,discardedWeights:points.length-filtered.length};
}

/* Composition remains a rough advisory estimate, separate from energy learning. */
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
  const reports = [...new Map(strengthReports
    .filter(r => r?.signal && r?.weekKey != null)
    .map(r => [String(r.weekKey), r])).values()]
    .sort((a,b) => Number(a.weekKey)-Number(b.weekKey) || String(a.weekKey).localeCompare(String(b.weekKey)))
  const lastTwo = reports.slice(-2)
  const consecutiveDown = lastTwo.length === 2 && lastTwo.every(r => r.signal === 'down') &&
    Number(lastTwo[1].weekKey) - Number(lastTwo[0].weekKey) === 1

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
  if (!anchor || trendNow == null || anchor.bf == null || !Number.isFinite(+anchor.bf) || +anchor.bf <= 0 || +anchor.bf >= 70) return null

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
export function projectGoal({ logs, currentBF, goalBF, currentWeight, leanMass, targetWeight = null }) {
  const trend = trendWeight(logs)
  // Need ~LEARN_DAYS of trend (and a few points) before projecting. Shorter
  // windows are water-contaminated and noisier — the trade-off for earlier
  // feedback. Counting entries alone let sparse logs through too early.
  const trendSpan = trend.length > 1
    ? _daySpan(trend[0].date, trend[trend.length - 1].date) + 1 : 0
  if (trend.length < 4 || trendSpan < LEARN_DAYS || (!(+targetWeight > 0) && (currentBF == null || !Number.isFinite(+currentBF)))) return { early: true }

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

  // goal weight at goal BF, holding current lean mass
  const goalWeight = +targetWeight > 0 ? +targetWeight : leanMass / (1 - goalBF / 100)
  const kgToGo     = currentWeight - goalWeight
  if (kgToGo <= 0) return { reached: true }
  if (meanRate >= -NOISE_STALLED_RATE_KG) return { stalled: true, meanRateKg: Math.round(meanRate * 100) / 100 }

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
  currentWeight, currentBF, goalBF, leanMass, targetWeight = null,
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
  const goalWeight   = +targetWeight > 0 ? +targetWeight : leanMass / (1 - goalBF / 100)
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
        'I won\'t judge your pace until I\'ve learned your real loss rate (about two weeks).',
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
        'The plan returns to estimated maintenance once the goal is confirmed. Keep logging through the initial water-weight change.',
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
  // Activity is credited back as food. A larger step prescription therefore
  // cannot promise faster loss at the full allowance. Deadline pressure is
  // reported separately; the budget engine controls the planned deficit.
  const scheduleNeedsMovement = false

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
        'Falling lifts can reflect fatigue or under-recovery; they are a risk signal, not proof of muscle loss.',
        'Review your food allowance and recovery before reducing intake further.',
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
      actions: ['Movement goals are reviewed weekly.', `Keep ${currentSteps.toLocaleString()} steps/day until the review window is complete.`, 'The baseline food target stays steady; completed extra steps still earn their usual food credit.'],
      cardioRx: null,
      recommendedSteps: currentSteps,
      goalTooAggressive,
      ...stats,
    }
  }

  let status, headline, actions = [], cardioRx = null

  if (gaining) {
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
    headline = `Losing ${actualRate.toFixed(2)} kg/wk — above the planning ceiling`
    actions = [
      `You're above the muscle-sparing ceiling (~${safeRateKg.toFixed(2)} kg/wk).`,
      'Review the allowance and recovery in Calorie Strategy before another change.',
      'Review several weeks of trend; early water changes can exaggerate the apparent rate.',
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
        ? `You can reduce the step goal to ${lowerStepGoal.toLocaleString()} and hold it for 7 days. Earned food follows actual movement.`
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

  if (status === 'lever_calories') {
    headline='Review calorie calibration'
    actions=['Confirm food and final step counts are complete.', 'Use the target in Calorie Strategy; its weekly review adjusts the estimate from actual results.', 'If the allowance reaches its floor, review the timeline instead of stacking further calorie cuts.']
  }
  if (status === 'lever_steps') {
    headline = `${gaining ? 'Rising trend' : 'Slower trend'} — review logs and movement`
    actions = [
      `Optional step goal: ${nextStepGoal.toLocaleString()}/day within your movement limit.`,
      'Completed extra steps earn food. Eating that credit preserves the planned deficit; it does not make the cut faster.',
      'Review complete food logs and the next calorie calibration. Extend the timeline if the required rate exceeds the planning ceiling.',
    ]
  } else if (status === 'lever_cardio') {
    headline = 'Review the trend; optional Zone 2 plan'
    actions = ['Use this cardio plan for fitness and routine within your recovery capacity.', 'Completed incline walking earns food after step overlap. Extra activity with its full food credit keeps the same planned deficit.', 'Review logging and the weekly budget before changing food or the deadline.']
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
  const adherenceWindow = logs.filter(l => l.date >= cutoffDate && l.date <= last.date && l.foodComplete===true && l.meals?.length)
  const calendarDays = Math.max(1, _daySpan(cutoffDate, last.date) + 1)
  const mealCoverage = adherenceWindow.length / calendarDays
  if (!adherenceWindow.length) return null
  const fallbackTarget = Math.max(MIN_CALS, maintenance - 600)
  const avgTarget = adherenceWindow.reduce((sum, l) => sum + (l.planSnapshot?.eatTarget ?? targetCalories ?? fallbackTarget), 0) / adherenceWindow.length
  const avgIntake = adherenceWindow.reduce((sum, l) => sum + l.meals.reduce((day, meal) => day + (+meal.cals || 0), 0), 0) / adherenceWindow.length
  if (!Number.isFinite(avgIntake) || Math.abs(avgIntake-avgTarget) > 150) return null

  if (weeksIntoCut * 7 >= 14 && mealCoverage >= 0.95 && movementAdherence === 1 && rate >= -0.05 && rate <= 0.05) {
    const protein = proteinTargetForWeight(currentWeight, { factor: proteinFactor })
    return {
      kind: 'mini_refeed', durationDays: 2,
      headline: 'Flat trend — optional 2-day maintenance break',
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
  // only a TRUE plateau qualifies: not losing, but not gaining either —
  // gaining means intake, not adaptation, and the pace coach handles that
  if (rate <= -REFEED_FLAT_RATE_KG || rate >= REFEED_FLAT_RATE_KG) return null

  if (weeksIntoCut >= 8) {
    return {
      kind: 'break',
      headline: 'Stalled 2+ weeks, 8+ weeks deep — take a diet break',
      reason: `Trend has been flat (~${Math.abs(rate).toFixed(2)} kg/wk) for two weeks after ${Math.floor(weeksIntoCut)} weeks of dieting. Review intake, activity and recovery before assuming the cause.`,
      protocol: [
        `Eat at maintenance (~${Math.round(maintenance)} kcal) for ONE FULL WEEK. This is a reset, not a cheat.`,
        `Keep protein at ${proteinTargetForWeight(currentWeight, { factor: proteinFactor })}g and keep training — most of the scale jump will be water/glycogen.`,
        'After the week, review the trend and resume the calculated deficit if appropriate; a break does not guarantee faster loss.',
      ],
    }
  }
  return {
    kind: 'refeed',
    headline: 'Genuine plateau — schedule a refeed day',
    reason: `Trend has been flat (~${Math.abs(rate).toFixed(2)} kg/wk) for two weeks while you've been in a deficit. A planned maintenance day may help adherence and training; it does not guarantee faster fat loss.`,
    protocol: [
      `Pick ONE day (ideally a hard training day): eat at maintenance (~${Math.round(maintenance)} kcal).`,
      `Put the extra calories almost entirely into CARBS — keep protein at ${proteinTargetForWeight(currentWeight, { factor: proteinFactor })}g, fat stays low.`,
      'Scale weight can rise temporarily with extra carbohydrate intake. Review the trend rather than treating one weigh-in as fat gain.',
    ],
  }
}

export function macrosFromCalories(calTarget, proteinG = PROTEIN_CONFIG.min, currentWeightKg = null, proteinOptions = {}) {
  const targetProteinG = currentWeightKg != null
    ? proteinTargetForWeight(currentWeightKg, proteinOptions)
    : (Number.isFinite(+proteinG) && +proteinG > 0 ? +proteinG : PROTEIN_CONFIG.min)
  // Cap protein at 60% of a small calorie allowance
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

// The final allowance is resolved once; removed schedule settings have no input.
export function buildDayPlan({baseTarget,maintenance,floor=MIN_CALS,activityCredit=0,currentWeightKg=null,proteinFactor=PROTEIN_CONFIG.factor}) {
  const minimum=Math.max(MIN_CALS,Math.round(floor));
  const neutral=Math.max(minimum,Math.round(baseTarget));
  const eatTarget=Math.max(minimum,neutral+(Number.isFinite(+activityCredit)?Math.round(+activityCredit):0));
  return {eatTarget,...macrosFromCalories(eatTarget,null,currentWeightKg,{factor:proteinFactor}),maintenance:Math.round(maintenance),deficit:Math.round(maintenance-eatTarget),baseTarget:neutral,activityNeutralTarget:neutral,activityCredit:eatTarget-neutral};
}

export const ENGINE_CONST = {
  MIN_CALS, SAFE_RATE, IDEAL_RATE,
  NOISE_GAINING_RATE_KG, NOISE_STALLED_RATE_KG, REFEED_FLAT_RATE_KG,
  PROTEIN_CONFIG, EWMA_CONFIG, ENERGY_DENSITY_CONFIG,
  DEFAULT_MAX_STEP_BUDGET, MOVEMENT_HOLD_DAYS, CALORIE_HOLD_DAYS,
  LEANNESS_CONFIG,
}
