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

const KCAL_PER_KG = 7700          // energy in 1kg of body mass (mixed)
const MIN_CALS    = 1200          // physiological floor
const SAFE_RATE   = 0.0100        // max %BW/week before muscle risk climbs
const IDEAL_RATE  = 0.0070        // muscle-sparing sweet spot (%BW/week)
// How many days of data before Cut IQ starts JUDGING (projection, pace,
// live TDEE). Shorter = faster feedback but noisier (water/glycogen).
// Single source so every Cut IQ surface stays in sync.
export const LEARN_DAYS = 7

/* local-date string helpers — all log keys are LOCAL 'YYYY-MM-DD' strings,
   so date math must stay in local time (toISOString would shift the day
   for anyone east of UTC) */
const _pad      = n => String(n).padStart(2, '0')
const _dateStr  = d => `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`
const _shiftDate = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return _dateStr(d) }
const _daySpan  = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)

/* ───────────────────────────────────────────────────────────────
   1. TREND WEIGHT  (Exponentially Weighted Moving Average)
   Smooths out water/glycogen/sodium noise. alpha ~0.10 ≈ 9-day half-life.
─────────────────────────────────────────────────────────────── */
export function trendWeight(logs, alpha = 0.10) {
  const weighed = logs
    .filter(l => l.weight != null)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!weighed.length) return []
  let ewma = weighed[0].weight
  return weighed.map(l => {
    ewma = alpha * l.weight + (1 - alpha) * ewma
    return { date: l.date, raw: l.weight, trend: Math.round(ewma * 100) / 100 }
  })
}

/* Latest smoothed trend weight (or null) */
export function currentTrendWeight(logs) {
  const t = trendWeight(logs)
  return t.length ? t[t.length - 1].trend : null
}

/* ───────────────────────────────────────────────────────────────
   2. ROLLING TDEE ESTIMATE
   Energy balance: ΔW = (intake − TDEE) / 7700
   ⇒ TDEE ≈ avgIntake − (trendWeightChangePerDay × 7700)
   (losing ⇒ ΔW negative ⇒ TDEE sits ABOVE intake)
   Uses a trailing window of CALENDAR days that have intake data.
   A logged fasting day counts as a real 0-kcal intake day.
─────────────────────────────────────────────────────────────── */
export function estimateTDEE(logs, windowDays = 18) {
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
  // days with intake signal: meals logged, OR a deliberate fast (0 kcal)
  const withIntake = window.filter(l =>
    (Array.isArray(l.meals) && l.meals.length > 0) || l.fasting)
  if (withIntake.length < 5) return null   // not enough signal yet

  const avgIntake = withIntake.reduce((s, l) =>
    s + (l.meals || []).reduce((m, x) => m + (+x.cals || 0), 0), 0) / withIntake.length

  // trend-weight delta across the window span
  const firstDate = window.find(l => trendMap[l.date] != null)?.date
  const lastDate  = [...window].reverse().find(l => trendMap[l.date] != null)?.date
  if (!firstDate || !lastDate || firstDate === lastDate) return null

  const wStart = trendMap[firstDate]
  const wEnd   = trendMap[lastDate]
  const spanDays = Math.max(1, _daySpan(firstDate, lastDate))
  const kgChangePerDay = (wEnd - wStart) / spanDays            // negative when losing
  const tdee = Math.round(avgIntake - kgChangePerDay * KCAL_PER_KG)

  return {
    tdee,
    avgIntake: Math.round(avgIntake),
    weeklyRateKg: Math.round(kgChangePerDay * 7 * 100) / 100,  // kg/week (neg = loss)
    spanDays: Math.round(spanDays),
    dataPoints: withIntake.length,
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

/* Estimate current fat mass & BF% from an anchor + modelled fat loss.
   anchor = { date, weight, bf }  (your honest visual/Realme re-anchor)
   Re-anchors completely reset the model from that point. */
export function inferBodyComp({ logs, anchor, strengthSignal, startDate }) {
  const trendNow = currentTrendWeight(logs)
  if (!anchor || trendNow == null) return null

  const anchorTrend = (() => {
    const t = trendWeight(logs)
    // trend weight closest to (>=) anchor date
    const at = t.find(x => x.date >= anchor.date) || t[t.length - 1]
    return at ? at.trend : anchor.weight
  })()

  const massLost = anchorTrend - trendNow            // kg lost since anchor (positive)
  const weeksIn  = Math.max(0, (new Date() - new Date(startDate + 'T00:00:00')) / 604800000)
  const ff       = fatFraction(strengthSignal, weeksIn) ?? 0.85

  const anchorFatMass = anchor.weight * (anchor.bf / 100)
  const fatLost       = Math.max(0, massLost) * ff
  const leanLost      = Math.max(0, massLost) * (1 - ff)
  const newFatMass    = Math.max(0, anchorFatMass - fatLost)
  const newBF         = trendNow > 0 ? (newFatMass / trendNow) * 100 : anchor.bf

  return {
    bf: Math.round(newBF * 10) / 10,
    fatMass: Math.round(newFatMass * 10) / 10,
    fatLost: Math.round(fatLost * 100) / 100,
    leanLost: Math.round(leanLost * 100) / 100,
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
  if (trend.length < 4 || trendSpan < LEARN_DAYS || currentBF == null) return { early: true }

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

  if (meanRate >= -0.05) return { stalled: true, meanRateKg: Math.round(meanRate * 100) / 100 }

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
  currentCardioMin = 0, strengthSignal,
  dataDays = 0,           // # of logged days with usable data
  hasRate = false,        // whether actualWeeklyRateKg is a real measurement (not a 0 placeholder)
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

  const safeRateKg  = currentWeight * SAFE_RATE
  const idealRateKg = currentWeight * IDEAL_RATE

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
      requiredRateKg: Math.round(requiredRate * 100) / 100,
      requiredPct: Math.round(requiredPct * 1000) / 10,
      actualRateKg: hasRate ? Math.round(lossRate * 100) / 100 : null,
      safeRateKg: Math.round(safeRateKg * 100) / 100,
      idealRateKg: Math.round(idealRateKg * 100) / 100,
      goalTooAggressive: daysLeft >= 7 && requiredPct > SAFE_RATE,
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
        'Keep protein at 130g and keep lifting — that locks the result in.',
      ],
      cardioRx: null,
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
  const goalTooAggressive = daysLeft >= 7 && requiredPct > SAFE_RATE
  const losingMuscle = strengthSignal === 'down'
  const gaining      = lossRate < -0.05            // trend rising >50g/wk

  // healthy band: from a gentle floor (~60% of ideal) up to the safe ceiling
  const healthyFloor = idealRateKg * 0.6
  const onTrack  = actualRate >= healthyFloor && actualRate <= safeRateKg * 1.1
  const tooFast  = actualRate > safeRateKg * 1.1
  // only "too slow" if losing meaningfully less than a healthy minimum
  const tooSlow  = actualRate < healthyFloor

  let status, headline, actions = [], cardioRx = null

  if (losingMuscle) {
    status = 'muscle_risk'
    headline = 'Strength is dropping — ease the deficit'
    actions = [
      'Your lifts are falling, which signals muscle loss. Pull back, don\'t push harder.',
      'Add 100–150 kcal back (carbs around training) and hold for a week.',
      'Keep protein at 130g, prioritise sleep 7.5h+.',
    ]
  } else if (gaining) {
    status = 'gaining'
    headline = `Trend weight is rising ${Math.abs(lossRate).toFixed(2)} kg/wk`
    actions = [
      'Your smoothed trend is going up, not down — the deficit isn\'t real right now.',
      'Audit logging first: untracked oils, sauces and bites are the usual culprits.',
      'If logging is honest, trim ~150 kcal from the daily target and reassess in 7 days.',
    ]
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
      'You\'re losing at a healthy, muscle-sparing rate. Hold everything as is.',
      'Trend weight is moving the right way — consistency is doing its job.',
    ]
  } else if (tooSlow) {
    status = 'too_slow'
    // LEVER ORDER: steps → Zone 2 → calories
    if (currentSteps < 12000) {
      const newSteps = Math.min(currentSteps + 2000, 12000)
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
        weeklyMin: addMin,
        sessions,
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
        'Take it from carbs on rest days, keep protein at 130g.',
        'This is the last lever for a reason — protect food as long as possible.',
      ]
    }
  } else {
    status = 'on_track'
    headline = 'Holding steady'
    actions = ['Stay the course and keep logging.']
  }

  return { status, headline, actions, cardioRx, goalTooAggressive, ...stats }
}


/* ───────────────────────────────────────────────────────────────
   5b. REFEED / DIET-BREAK ADVISOR
   A genuine plateau (flat trend despite adherence) 4+ weeks into a
   cut is often adaptive: lowered NEAT, cortisol water retention,
   leptin drop. A structured refeed (1 day at maintenance, carbs up)
   or a full diet break (1 week at maintenance, 8+ weeks in) is the
   evidence-based reset. Returns null when not warranted.
─────────────────────────────────────────────────────────────── */
export function suggestRefeed({ logs, weeksIntoCut, maintenance }) {
  if (weeksIntoCut < 4) return null
  const trend = trendWeight(logs)
  if (trend.length < 10) return null
  const span = _daySpan(trend[0].date, trend[trend.length - 1].date) + 1
  if (span < 28) return null                       // need a month of context

  // rate over the trailing ~14 days
  const last = trend[trend.length - 1]
  const cutoffDate = _shiftDate(last.date, -14)
  const past = trend.filter(t => t.date <= cutoffDate)
  if (!past.length) return null
  const ref = past[past.length - 1]
  const days = _daySpan(ref.date, last.date)
  if (days < 10) return null
  const rate = (last.trend - ref.trend) / days * 7   // kg/week

  // only a TRUE plateau qualifies: not losing, but not gaining either —
  // gaining means intake, not adaptation, and the pace coach handles that
  if (rate <= -0.15 || rate >= 0.15) return null

  if (weeksIntoCut >= 8) {
    return {
      kind: 'break',
      headline: 'Stalled 2+ weeks, 8+ weeks deep — take a diet break',
      reason: `Trend has been flat (~${Math.abs(rate).toFixed(2)} kg/wk) for two weeks after ${Math.floor(weeksIntoCut)} weeks of dieting. That pattern usually means metabolic adaptation, not failure.`,
      protocol: [
        `Eat at maintenance (~${Math.round(maintenance)} kcal) for ONE FULL WEEK. This is a reset, not a cheat.`,
        'Keep protein at 130g and keep training — most of the scale jump will be water/glycogen.',
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
      'Put the extra calories almost entirely into CARBS — keep protein at 130g, fat stays low.',
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
   Protein is FIXED at 130g; remaining kcal split 50/50 carb/fat.

   params:
     baseTarget   — Cut IQ recommended daily target (or adaptiveTDEE.target fallback)
     tdeeBase     — maintenance TDEE (for zigzag wave math)
     regime       — 'steady' | 'zigzag'
     zigzag       — { schedule, mode }
     fasting      — { isFasting, compensation }  (compensation = 25% if true)
     dateObj      — Date to resolve for (defaults today)
─────────────────────────────────────────────────────────────── */
const PROTEIN_G = 130
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
export function zigzagWeek(target, schedule = 1, intensity = 'weight', floor = MIN_CALS) {
  const ampScale = intensity === 'mild' ? 0.6 : intensity === 'extreme' ? 1.5 : 1
  const pattern = _ZZ_PATTERN[schedule] || _ZZ_PATTERN[1]
  const patMean = pattern.reduce((s, x) => s + x, 0) / 7   // center the pattern
  const todayDow = new Date().getDay()
  return _DAYS.map((name, dow) => {
    const pct = (pattern[dow] - patMean) * ampScale
    const cals = Math.max(floor, Math.round(target * (1 + pct)))
    return { name, cals, isToday: todayDow === dow }
  })
}

export function macrosFromCalories(calTarget, proteinG = PROTEIN_G) {
  // on tiny targets (25% fast compensation) cap protein at 60% of the day
  // so the macro grams can never sum past the calorie target
  const p = Math.min(proteinG, Math.floor(calTarget * 0.6 / 4))
  const remaining = Math.max(calTarget - p * 4, 0)
  return {
    calTarget,
    proteinG: p,
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
  dateObj = new Date(),
}) {
  const todayDow = dateObj.getDay()
  const floorCals = Math.max(MIN_CALS, Math.round(floor))

  // --- compute the weekly eat-targets (zigzag) or flat (steady) ---
  // This is the ONLY place zigzag math happens. zigzagWeek swings around
  // the cut TARGET (mean === target), and never drops below the floor.
  let weekEat            // array[7] of kcal to eat each weekday (pre-fasting)
  if (regime === 'zigzag') {
    const raw = zigzagWeek(baseTarget, zigzag.schedule, zigzag.mode, floorCals)
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

  const macros  = eatTarget > 0 ? macrosFromCalories(eatTarget) : { calTarget: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 }
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

export const ENGINE_CONST = { KCAL_PER_KG, MIN_CALS, SAFE_RATE, IDEAL_RATE, PROTEIN_G }
