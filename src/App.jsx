import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { C, F, SHADOW, GLOW, card, btn, inp, LBL, TT, RADIUS, BAR, useIsMobile, buzz } from './lib/theme'
import { Icon } from './lib/icons'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, ComposedChart,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine
} from 'recharts'
import { supabase } from './lib/supabase'
import { store } from './lib/store'
import { DEMO, demoSession } from './lib/demo'
import WorkoutTab from './WorkoutTab'
import CutIQTab from './CutIQTab'
import { buildDayPlan, macrosFromCalories, currentTrendWeight, trendWeight, estimateTDEE, inferBodyComp, ENGINE_CONST, LEARN_DAYS } from './lib/cutEngine'
import { FOOD_DB, FOOD_CATS, computeFoodMacros, mealFromFood, mealFromRecipe } from './lib/foodDB'
import { getDayMicronutrients, getNutritionCoach } from './lib/nutrientCoach'
import { addMicros, NUTRIENTS } from './lib/nutrientEngine'
import { estimateRFM, BODY_MEASUREMENTS, isSunday, normalizeMeasurements } from './lib/bodyFat'

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════ */
// LOCAL date strings everywhere — toISOString() is UTC, which made "today"
// flip at 05:30 IST and wrote post-midnight logs onto yesterday's key.
const pad2        = n => String(n).padStart(2, '0')
const localDateStr = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const todayStr    = () => localDateStr()
const addDaysStr  = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return localDateStr(d) }
// Calendar weeks run Sunday through Saturday. A review only covers a fully
// completed calendar week, so the current week's Sunday is never included.
const startOfWeekStr = (s = todayStr()) => addDaysStr(s, -new Date(s + 'T12:00:00').getDay())
const fmtDate     = d  => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
const daysBetween = (a, b) => Math.max(0, Math.floor((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000))
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const ACTIVITY = [
  { id: 'sed',    label: 'Sedentary — desk job, no exercise',      mult: 1.15  },
  { id: 'light',  label: 'Light — 1–3x/week training',            mult: 1.30  },
  { id: 'mod',    label: 'Moderate — 3–5x/week training',         mult: 1.45  },
  { id: 'active', label: 'Very Active — 6–7x/week hard training', mult: 1.60  },
  { id: 'extra',  label: 'Athlete — 2x/day or physical job',      mult: 1.75  },
]

function calcBMR(w, h, age, sex = 'male', bfPct = null) {
  if (bfPct != null && bfPct > 0) return 370 + 21.6 * (w * (1 - bfPct / 100))
  return sex === 'male' ? 10*w + 6.25*h - 5*age + 5 : 10*w + 6.25*h - 5*age - 161
}

/* ─── TRUE ADAPTIVE TDEE ─────────────────────────────────────────
   After ~1 week of real data, blends the formula TDEE with the
   measured one from estimateTDEE() (energy balance:
   TDEE = avg_intake − ΔtrendWeight × 7700 / days).
──────────────────────────────────────────────────────────────── */
// Deficit presets. Active Cut is the "energy flux" path: a bigger TOTAL
// deficit that's partly PAID FOR by deliberate cardio (incline walking),
// so you eat MORE than a standard cut while losing faster.
const STD_DEFICIT    = 600
const ACTIVE_DEFICIT = 700
// Net (above-rest) incline-walk burn ≈ 0.08 kcal per kg per minute
// (~4.5 METs above rest, conservative so we never over-credit and stall).
const CARDIO_KCAL_PER_KG_MIN = 0.08
export function inclineWalkBurn(minutes, weightKg) {
  return Math.round((+minutes || 0) * (+weightKg || 0) * CARDIO_KCAL_PER_KG_MIN)
}

function getAdaptiveTDEE(setup, logs, planSettings = {}, asOfDate = todayStr()) {
  if (!setup) return { target: 1800, base: 2400, adj: 0, curW: 70, deficit: 600, isDataDriven: false, bmr: 1600, phase: 'cut', activeCut: false, cardioBurn: 0, cardioMin: 0, foodDeficit: 600, effMaint: 2400 }
  const scopedLogs = logs.filter(l => l.date <= asOfDate)
  const wLogs = scopedLogs.filter(l => l.weight != null).sort((a, b) => a.date.localeCompare(b.date))
  // use the SMOOTHED trend weight, not the raw last weigh-in: a fasting day (or
  // any water/glycogen swing) makes the latest scale reading jump, which would
  // wobble BMR → maintenance → today's target. Trend absorbs that. Falls back
  // to the raw reading, then the start weight, before any logs exist.
  const curW  = currentTrendWeight(scopedLogs) ?? wLogs.at(-1)?.weight ?? setup.startWeight
  const mult  = ACTIVITY.find(a => a.id === setup.activity)?.mult ?? 1.45
  const bmr   = Math.round(calcBMR(curW, setup.height, setup.age, setup.sex, setup.startBF))
  const formulaTDEE = Math.round(bmr * mult)

  // ── Maintenance estimation (coach-standard) ──
  // Weeks 1-2: trust the formula completely (early loss is water/glycogen,
  // so scale-derived TDEE is meaningless and would crater the target).
  // Week 3+: BLEND formula with the data estimate, but CLAMP the data
  // value to ±15% of the formula so a noisy regression can't swing the
  // target into famine territory.
  let base = formulaTDEE, isDataDriven = false
  // LEARN_DAYS gate is a WATER-CLEARANCE clock — measure calendar days since
  // the first log, not how many entries exist (sparse logs aren't faster
  // physiology). The ±15% clamp + BMR floor keep an early, noisier estimate safe.
  const datedLogs = scopedLogs.filter(l => l.weight != null || (l.meals && l.meals.length) || l.fasting)
  const daysLogged = datedLogs.length
  const spanDays = datedLogs.length ? daysBetween(datedLogs[0].date, asOfDate) + 1 : 0
  if (spanDays >= LEARN_DAYS && daysLogged >= 5) {
    // feed scheduled/manual fasts into the regression at their real intake
    // (0 for a full fast, ~25% of target for compensation days)
    const fastComp   = !!planSettings.fastCompensation
    const approxTgt  = Math.max(bmr, formulaTDEE - (setup.activeCut ? ACTIVE_DEFICIT : STD_DEFICIT))
    const est = estimateTDEE(scopedLogs, {
      fastingDays: planSettings.fastingDays || [],
      fastComp,
      fastKcal: fastComp ? Math.round(approxTgt * 0.25) : 0,
    })
    if (est && est.tdee > 0) {
      const lo = formulaTDEE * 0.85, hi = formulaTDEE * 1.15
      const clamped = Math.min(hi, Math.max(lo, est.tdee))   // never >15% off formula
      base = Math.round(formulaTDEE * 0.5 + clamped * 0.5)   // 50/50 blend
      isDataDriven = true
    }
  }

  // ── Phase: cutting until cutLength days, then maintenance ──
  const cutLen = setup.cutLength || 60
  const dayN   = setup.startDate ? Math.max(1, daysBetween(setup.startDate, asOfDate) + 1) : 1
  const phase  = dayN > cutLen ? 'maintenance' : 'cut'

  // ── ACTIVE CUT (energy-flux path, per-user) ──
  // Deliberate incline walking is credited into your maintenance so you EAT
  // MORE for moving more. Critically, we credit it ONLY in the formula phase:
  // once the engine is data-driven, your measured TDEE already reflects the
  // cardio (it shows up as faster real weight loss), so adding it again would
  // double-count. effMaint is the cardio-inclusive maintenance the target/
  // deficit are figured against; base stays your baseline maintenance display.
  const activeCut  = !!setup.activeCut
  const cardioMin  = activeCut ? (setup.cardioMin ?? 35) : 0
  const cardioBurn = activeCut ? inclineWalkBurn(cardioMin, curW) : 0
  const cardioCredit = (activeCut && !isDataDriven) ? cardioBurn : 0
  const effMaint   = base + cardioCredit
  const stdDeficit = activeCut ? ACTIVE_DEFICIT : STD_DEFICIT
  const foodDeficit = Math.max(0, stdDeficit - cardioBurn)   // portion from eating less
  const extra = { activeCut, cardioBurn, cardioMin, foodDeficit, effMaint }

  // ── Target = maintenance − deficit, floored at BMR (never below resting) ──
  if (setup.manualCalTarget) {
    const t = Math.max(bmr, +setup.manualCalTarget)
    return { target: t, base, adj: 0, curW, deficit: effMaint - t, isDataDriven, isManual: true, bmr, phase, ...extra }
  }
  if (phase === 'maintenance') {
    // reverse-diet ramp: +150 kcal each week after the cut ends, from the
    // cut target up to true maintenance (reaches it in ~4 weeks)
    const weeksOver = Math.ceil((dayN - cutLen) / 7)
    const target = Math.max(bmr, Math.min(base, Math.round(base - 600 + 150 * weeksOver)))
    return { target, base, adj: 0, curW, deficit: base - target, isDataDriven, bmr, phase, weeksOver, ...extra }
  }
  const target = Math.max(bmr, Math.round(effMaint - stdDeficit))
  return { target, base, adj: 0, curW, deficit: effMaint - target, isDataDriven, bmr, phase, ...extra }
}

function getPlanForDate({ date, log, setup, logs, planSettings = {}, zigzagSettings = {} }) {
  const tdee = getAdaptiveTDEE(setup, logs, planSettings, date)
  return buildDayPlan({
    baseTarget: tdee.target,
    maintenance: tdee.effMaint ?? tdee.base,
    floor: tdee.bmr,
    regime: zigzagSettings.on ? 'zigzag' : 'steady',
    zigzag: { schedule: zigzagSettings.schedule || 1, mode: zigzagSettings.mode || 'weight' },
    fastingDays: planSettings.fastingDays || [],
    fastComp: !!planSettings.fastCompensation,
    manualFastToday: !!log?.fasting,
    overriddenToday: !!log?.fastingOverridden,
    dateObj: new Date(date + 'T12:00:00'),
  })
}

function createPlanSnapshot({ date, log, setup, logs, planSettings = {}, zigzagSettings = {}, source = 'captured' }) {
  const tdee = getAdaptiveTDEE(setup, logs, planSettings, date)
  const plan = getPlanForDate({ date, log, setup, logs, planSettings, zigzagSettings })
  return {
    target:tdee.target, base:tdee.base, bmr:tdee.bmr,
    effMaint:tdee.effMaint ?? tdee.base, activeCut:tdee.activeCut,
    cardioBurn:tdee.cardioBurn, cardioMin:tdee.cardioMin,
    phase:tdee.phase, eatTarget:plan.eatTarget, deficit:plan.deficit,
    source,
  }
}

/* ─── ZIGZAG CALORIE CYCLING ─────────────────────────────────────
   Zigzag is a bounded % SWING around the daily cut target — the weekly
   deficit is IDENTICAL to Steady mode in every intensity. Intensity only
   scales how far high/low days spread from the target:
     Mild:    ±~9% swing
     Weight:  ±~15% swing (standard)
     Extreme: ±~22% swing
   Schedule 1: weekends high · Schedule 2: wave peaking Wednesday
──────────────────────────────────────────────────────────────── */
const MIN_CALS = 1200

const ZIGZAG_LABELS = { mild: 'Mild (±9% swing)', weight: 'Standard (±15% swing)', extreme: 'Strong (±22% swing)' }


/* ─── DYNAMIC STEP GOAL ──────────────────────────────────────────*/
function getDynamicStepGoal(setup, logs, tdeeData, planSettings = {}, zigzagSettings = {}, prescribedSteps = null, currentLog = null, currentPlan = null) {
  const baseline = setup?.stepGoal || 10000
  const base = prescribedSteps || baseline
  const calPerStep = tdeeData.curW * 0.00061
  // Keep a rolling calorie debt. Over-target calories add to it; only steps
  // above the normal daily goal pay it down. This means completed compensation
  // is credited, while unfinished compensation carries into the next day.
  let debt = 0
  const priorLogs = logs.filter(l => l.date < todayStr()).sort((a, b) => a.date.localeCompare(b.date))
  for (const log of priorLogs) {
    const target = log.planSnapshot?.eatTarget ?? getPlanForDate({ date:log.date, log, setup, logs, planSettings, zigzagSettings }).eatTarget
    const calories = (log.meals || []).reduce((s, m) => s + (+m.cals || 0), 0)
    // A fast is not an ordinary zero-calorie day relative to the target
    // saved in the snapshot. A complete fast creates a deficit against
    // maintenance/TDEE, so credit that full deficit against earlier
    // over-target intake. Use the normal version of the day to recover the
    // correct maintenance value and to handle scheduled fast snapshots too.
    const isLoggedFast = log.fasting === true || log.planSnapshot?.eatTarget === 0
    const normalPlan = isLoggedFast
      ? getPlanForDate({
          date: log.date,
          log: { ...log, fasting: false, fastingOverridden: true },
          setup,
          logs,
          planSettings,
          zigzagSettings,
        })
      : null
    const debtTarget = normalPlan?.maintenance ?? target
    debt += isLoggedFast ? calories - debtTarget : Math.max(0, calories - debtTarget)
    const extraSteps = Math.max(0, (+log.steps || 0) - baseline)
    debt = Math.max(0, debt - extraSteps * calPerStep)
  }
  // Include the live day as well. This lets a user eat over target and pay
  // for those calories with extra steps immediately, instead of waiting for
  // tomorrow's recalculation. The same kcal-per-step conversion is used on
  // both sides, so matching the overage with movement clears it today.
  if (currentLog?.date === todayStr()) {
    const target = currentPlan?.eatTarget ?? currentLog.planSnapshot?.eatTarget ?? getPlanForDate({ date:currentLog.date, log:currentLog, setup, logs, planSettings, zigzagSettings }).eatTarget
    const calories = (currentLog.meals || []).reduce((s, m) => s + (+m.cals || 0), 0)
    const isLoggedFast = currentLog.fasting === true || currentLog.planSnapshot?.eatTarget === 0
    const normalPlan = isLoggedFast
      ? (currentPlan?.maintenance != null ? currentPlan : getPlanForDate({
          date: currentLog.date,
          log: { ...currentLog, fasting:false, fastingOverridden:true },
          setup,
          logs,
          planSettings,
          zigzagSettings,
        }))
      : null
    const debtTarget = normalPlan?.maintenance ?? target
    debt += isLoggedFast ? calories - debtTarget : Math.max(0, calories - debtTarget)
    const extraSteps = Math.max(0, (+currentLog.steps || 0) - baseline)
    debt = Math.max(0, debt - extraSteps * calPerStep)
  }
  if (debt <= 0) return { goal: base, extra: 0, reason: null }
  const extra = Math.min(Math.ceil(debt / calPerStep), 6000)
  return { goal: Math.max(base, baseline + extra), extra, reason: `+${extra.toLocaleString()} steps to clear ${Math.ceil(debt)} kcal of outstanding compensation` }
}

/* ─── STREAKS ────────────────────────────────────────────────────
   Consecutive-day counts ending today (or yesterday if today isn't
   logged yet — an unfinished day never breaks a streak). */
function getStreaks(logs) {
  const byDate = Object.fromEntries(logs.map(l => [l.date, l]))
  const loggedDay = l => !!l && (l.weight != null || (l.meals && l.meals.length > 0) || l.fasting)
  const protDay   = l => !!l && (l.meals || []).reduce((s, m) => s + (+m.protein || 0), 0) >= ENGINE_CONST.PROTEIN_G - 10
  const count = pred => {
    let d = todayStr(), n = 0
    if (!pred(byDate[d])) d = addDaysStr(d, -1)
    while (pred(byDate[d])) { n++; d = addDaysStr(d, -1) }
    return n
  }
  return { logging: count(loggedDay), protein: count(protDay) }
}

/* ─── COACH INSIGHTS ─────────────────────────────────────────────*/
function getCoachInsights(setup, logs, todayLog, tdeeData, regime, macros, stepData, isToday = true, streaks = null) {
  if (!todayLog) return []
  const todayCals    = todayLog.meals?.reduce((s, m) => s + (+m.cals || 0), 0) || 0
  const todayProtein = Math.round((todayLog.meals?.reduce((s, m) => s + (+m.protein || 0), 0) || 0) * 10) / 10
  const insights     = []
  if (tdeeData.phase === 'maintenance') {
    insights.push({ color: C.good, msg: `Cut complete — maintenance mode. Target is ramping +150 kcal/week toward your true maintenance (${tdeeData.base} kcal). Today: ${macros.calTarget} kcal.` })
  } else if (macros.calTarget === 0) {
    insights.push({ color: C.info, msg: `Fasting day — 0 kcal target. Stay hydrated; electrolytes help if you feel flat.` })
  } else {
    insights.push({ color: C.accent, msg: `Today's target: ${macros.calTarget} kcal · ${macros.proteinG}g protein${regime === 'zigzag' ? ' (zigzag day)' : ''}.` })
  }
  // streak recognition
  if (streaks && streaks.logging >= 3) {
    insights.push({ color: C.orange, msg: `${streaks.logging}-day logging streak${streaks.protein >= 2 ? ` — and protein target hit ${streaks.protein} days straight` : ''}. Consistency is the whole game.` })
  }
  // weekly review pointer on Sun/Mon
  if ([0, 1].includes(new Date().getDay()) && logs.filter(l => l.meals?.length || l.weight != null).length >= 7) {
    insights.push({ color: C.gold, msg: `Your weekly review is ready — check the top of the Progress tab.` })
  }
  // in-app nudges — only meaningful for the live "today" view
  if (isToday) {
    const hour = new Date().getHours()
    if (hour >= 12 && todayLog.weight == null) {
      insights.push({ color: C.gold, msg: `No weigh-in yet today — the trend model is only as good as its data.` })
    }
    if (hour >= 21 && (!todayLog.meals || todayLog.meals.length === 0) && !todayLog.fasting && macros.calTarget > 0) {
      insights.push({ color: C.gold, msg: `No meals logged today. Log them now while you still remember — or hit the fasting button if you fasted.` })
    }
    // Active Cut: the eat target already assumes today's walk — nudge to actually do it
    if (tdeeData.activeCut && tdeeData.cardioMin > 0) {
      const done = todayLog.inclineMin || 0
      if (done >= tdeeData.cardioMin) {
        insights.push({ color: C.good, msg: `Incline walk done — that's ${tdeeData.cardioBurn} kcal of deficit earned through movement, not hunger. This is the sustainable way.` })
      } else if (hour >= 17) {
        insights.push({ color: C.orange, msg: `Incline walk not logged yet (${done}/${tdeeData.cardioMin} min). Your calories today assume you do it — skipping it quietly erases the deficit.` })
      }
    }
  }
  if (stepData.extra > 0) {
    const kcal = Math.round(stepData.extra * tdeeData.curW * 0.00061)
    insights.push({ color: C.orange, msg: `You have ~${kcal} kcal of outstanding compensation. Walk ${stepData.extra.toLocaleString()} extra steps today to stay in deficit.` })
  }
  if (macros.calTarget > 0 && todayCals > macros.calTarget * 0.4) {
    const short = Math.round((macros.proteinG - todayProtein) * 10) / 10
    if (short > 20) insights.push({ color: C.bad, msg: `Protein is ${short}g short of today's ${macros.proteinG}g target. Add a protein source to your next meal.` })
  }
  if (todayLog.sleep > 0 && todayLog.sleep < 6.5) {
    insights.push({ color: C.bad, msg: `Only ${todayLog.sleep}h sleep. Low sleep raises cortisol and hunger, blunting fat loss. Aim for 7–8h tonight.` })
  }
  // Weekly pace verdict — gated to 14 calendar days (water-clearance rule,
  // same as every Cut IQ surface) and computed over REAL weeks, not the last
  // N entries (sparse logging used to stretch "this week" over a month).
  const wLogs = logs.filter(l => l.weight != null).sort((a, b) => a.date.localeCompare(b.date))
  if (wLogs.length >= 8 && daysBetween(wLogs[0].date, todayStr()) + 1 >= 14) {
    const cut7  = addDaysStr(todayStr(), -7)
    const cut14 = addDaysStr(todayStr(), -14)
    const r7 = wLogs.filter(l => l.date > cut7).map(l => l.weight)
    const p7 = wLogs.filter(l => l.date > cut14 && l.date <= cut7).map(l => l.weight)
    if (r7.length >= 3 && p7.length >= 3) {
      const rAvg = r7.reduce((s, x) => s + x) / r7.length
      const pAvg = p7.reduce((s, x) => s + x) / p7.length
      const wkLoss = pAvg - rAvg
      if (wkLoss < -0.15)    insights.push({ color: C.bad, msg: `Weight is up ${Math.abs(wkLoss).toFixed(2)}kg vs last week. Check the Cut IQ tab — something needs tightening.` })
      else if (wkLoss < 0.2) insights.push({ color: C.orange, msg: `Only ${wkLoss.toFixed(2)}kg lost this week. Check the Cut IQ tab — it'll tell you which lever to pull.` })
      else if (wkLoss > 1.2) insights.push({ color: C.info, msg: `Losing ${wkLoss.toFixed(1)}kg/wk — faster than ideal. Cut IQ may suggest easing the deficit to protect muscle.` })
      else                   insights.push({ color: C.accent, msg: `Down ${wkLoss.toFixed(2)}kg this week — right on target. Stay consistent.` })
    }
  }
  return insights.slice(0, 6)
}

/* ═══════════════════════════════════════════════════════════════
   AUTH SCREEN
═══════════════════════════════════════════════════════════════ */
function AuthScreen() {
  const [mode, setMode]       = useState('login')
  const [email, setEmail]     = useState('')
  const [pass, setPass]       = useState('')
  const [error, setError]     = useState('')
  const [notice, setNotice]   = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    setError(''); setNotice(''); setLoading(true)
    try {
      if (mode === 'login') {
        const { error: e } = await supabase.auth.signInWithPassword({ email, password: pass })
        if (e) setError(e.message)
      } else {
        const { data, error: e } = await supabase.auth.signUp({ email, password: pass })
        if (e) setError(e.message)
        // confirmation-required projects return a user but no session
        else if (data?.user && !data?.session) setNotice('Account created — check your email for the confirmation link, then sign in.')
      }
    } catch (err) {
      setError('Network error — check your connection.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <div style={{ background: `radial-gradient(ellipse 100% 70% at 50% 0%, #16111f 0%, ${C.bg} 60%)`, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F.body, color: C.text }}>
      <div style={{ width: '100%', maxWidth: 410, padding: 24 }}>
        <div style={{ textAlign: 'center', marginBottom: 44 }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:11, marginBottom: 14 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: C.accent, boxShadow: `0 0 18px ${C.accent}` }} />
            <div style={{ fontFamily: F.head, fontSize: 40, fontWeight: 800, color: C.text, letterSpacing: '-0.03em' }}>CUTBOARD</div>
          </div>
          <div style={{ color: C.textSub, fontSize: 14 }}>Your transformation, tracked.</div>
        </div>
        <div style={card({ padding: '24px 24px 26px' })}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 26, background: '#0a0c10', borderRadius: 12, padding: 4 }}>
            {['login','signup'].map(m => <button key={m} onClick={() => { setMode(m); setError('') }} style={{ flex: 1, padding: '10px 0', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: F.body, fontSize: 13, fontWeight: mode===m?700:500, transition: 'all 0.18s', background: mode === m ? `linear-gradient(135deg, ${C.accent}, ${C.accentDim})` : 'transparent', color: mode === m ? '#0a1400' : C.textSub }}>{m === 'login' ? 'Sign In' : 'Create Account'}</button>)}
          </div>
          <div style={{ display: 'grid', gap: 14 }}>
            <div><label style={LBL}>Email</label><input style={inp()} type="email" value={email} placeholder="you@email.com" onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border} /></div>
            <div><label style={LBL}>Password</label><input style={inp()} type="password" value={pass} placeholder="••••••••" onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border} /></div>
            {error && <div style={{ background: '#1a0a0c', border: `1px solid ${C.red}33`, borderRadius: 11, padding: '11px 14px', fontSize: 13, color: C.red }}>{error}</div>}
            {notice && <div style={{ background: '#0a1612', border: `1px solid ${C.teal}33`, borderRadius: 11, padding: '11px 14px', fontSize: 13, color: C.teal }}>{notice}</div>}
            <button style={{ ...btn(true), width: '100%', padding: '13px 0', fontSize: 15, marginTop: 4 }} onClick={submit} disabled={loading}>{loading ? 'Please wait…' : (mode === 'login' ? 'Sign In' : 'Create Account')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   ONBOARDING
═══════════════════════════════════════════════════════════════ */
function Onboarding({ userEmail, onSave, existing, onCancel, onReset, onExport }) {
  const [f, setF] = useState({
    name: existing?.name ?? userEmail?.split('@')[0] ?? '', age: existing?.age ?? '', height: existing?.height ?? '',
    sex: existing?.sex ?? 'male', activity: existing?.activity ?? 'mod',
    startWeight: existing?.startWeight ?? '', startBF: existing?.startBF ?? '', goalBF: existing?.goalBF ?? 12,
    startDate: existing?.startDate ?? todayStr(), cutLength: existing?.cutLength ?? 60, stepGoal: existing?.stepGoal ?? 10000,
    carbCycling: existing?.carbCycling ?? false, trainingDays: existing?.trainingDays ?? [1,3,5],
    manualCalTarget: existing?.manualCalTarget ?? '',
    activeCut: existing?.activeCut ?? false, cardioMin: existing?.cardioMin ?? 35,
  })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const toggleDay = d => set('trainingDays', f.trainingDays.includes(d) ? f.trainingDays.filter(x => x !== d) : [...f.trainingDays, d])
  const lbm = f.startWeight && f.startBF ? f.startWeight * (1 - f.startBF / 100) : null
  const goalW = lbm && f.goalBF ? Math.round(lbm / (1 - f.goalBF / 100) * 10) / 10 : null
  const fatLose = goalW ? Math.round((f.startWeight - goalW) * 10) / 10 : null
  const wkRate  = fatLose ? Math.round(fatLose / ((f.cutLength || 60) / 7) * 100) / 100 : null
  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: F.body, color: C.text, padding: '40px 20px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ fontFamily: F.head, fontSize: 28, fontWeight: 800, marginBottom: 6 }}>{existing ? 'Edit Profile' : 'Setup Your Profile'}</div>
        <div style={{ color: C.textSub, fontSize: 14, marginBottom: 36 }}>These numbers power your adaptive TDEE, carb cycling, and coaching.</div>
        <div style={{ display: 'grid', gap: 24 }}>
          <div><label style={LBL}>Your Name</label><input style={inp({ maxWidth: 260 })} value={f.name} placeholder="Vishudh" onChange={e => set('name', e.target.value)} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(100px,1fr))', gap: 14 }}>
            <div><label style={LBL}>Age</label><input style={inp()} type="number" inputMode="decimal" value={f.age} placeholder="22" onChange={e => set('age', +e.target.value)} /></div>
            <div><label style={LBL}>Height (cm)</label><input style={inp()} type="number" inputMode="decimal" value={f.height} placeholder="175" onChange={e => set('height', +e.target.value)} /></div>
            <div><label style={LBL}>Sex</label><select style={inp()} value={f.sex} onChange={e => set('sex', e.target.value)}><option value="male">Male</option><option value="female">Female</option></select></div>
          </div>
          <div><label style={LBL}>Activity Level</label><div style={{ display: 'grid', gap: 8 }}>{ACTIVITY.map(a => <button key={a.id} style={{ ...btn(f.activity === a.id), textAlign: 'left', width: '100%', padding: '11px 16px' }} onClick={() => set('activity', a.id)}>{a.label}</button>)}</div></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(100px,1fr))', gap: 14 }}>
            <div><label style={LBL}>Start Weight (kg)</label><input style={inp()} type="number" inputMode="decimal" step="0.1" value={f.startWeight} placeholder="74.0" onChange={e => set('startWeight', +e.target.value)} /></div>
            <div><label style={LBL}>Start Body Fat %</label><input style={inp()} type="number" inputMode="decimal" step="0.1" value={f.startBF} placeholder="20" onChange={e => set('startBF', +e.target.value)} /></div>
            <div><label style={LBL}>Goal Body Fat %</label><input style={inp()} type="number" inputMode="decimal" step="0.1" value={f.goalBF} placeholder="12" onChange={e => set('goalBF', +e.target.value)} /></div>
          </div>
          {goalW && (
            <div style={card({ background: '#0a1209', borderColor: '#1a2f12', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', textAlign: 'center', gap: 12 })}>
              {[{val:goalW,unit:'kg',label:'Goal Weight',color:C.accent},{val:fatLose,unit:'kg',label:'Fat to Lose',color:C.orange},{val:lbm?.toFixed(1),unit:'kg',label:'Lean Mass',color:C.blue},{val:wkRate,unit:'kg/wk',label:'Target Rate',color:C.purple}].map(({val,unit,label,color}) => (
                <div key={label}><div style={{fontFamily:F.mono,fontSize:22,fontWeight:700,color,lineHeight:1}}>{val}</div><div style={{fontSize:10,color:C.textSub,marginTop:3,textTransform:'uppercase',letterSpacing:'0.08em'}}>{unit}</div><div style={{fontSize:11,color:C.textSub,marginTop:5}}>{label}</div></div>
              ))}
            </div>
          )}
          <div style={{ maxWidth: 240 }}><label style={LBL}>Base Daily Step Goal</label><input style={inp()} type="number" inputMode="decimal" step="500" value={f.stepGoal} placeholder="10000" onChange={e => set('stepGoal', +e.target.value)} /><div style={{ fontSize: 11, color: C.textSub, marginTop: 6 }}>Extra steps added automatically when you overeat</div></div>
          {/* ── Active Cut: eat more, move more (per-account) ── */}
          <div style={card({ background: f.activeCut ? '#0c1410' : '#0c0c0f', borderColor: f.activeCut ? `${C.teal}44` : C.border })}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display:'inline-flex', alignItems:'center', gap:7, fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 6 }}><Icon name="compass" size={16} color={C.teal} /> Active Cut <span style={{ fontSize: 11, color: C.teal, fontWeight: 600 }}>energy-flux mode</span></div>
                <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.55 }}>
                  Drive the deficit with <strong style={{ color: C.text }}>movement</strong> instead of starving. You eat <strong style={{ color: C.teal }}>more</strong> and add daily incline walking — better for adherence, NEAT and holding muscle. Your walk is credited into your calorie budget. Only affects <strong>your</strong> account.
                </div>
              </div>
              <button onClick={() => set('activeCut', !f.activeCut)} aria-label="toggle active cut"
                style={{ flexShrink: 0, width: 50, height: 28, borderRadius: 16, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                  background: f.activeCut ? `linear-gradient(135deg, ${C.teal}, #3aa897)` : '#2a2a31' }}>
                <span style={{ position: 'absolute', top: 3, left: f.activeCut ? 25 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
              </button>
            </div>
            {f.activeCut && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.borderSoft}` }}>
                <label style={LBL}>Daily incline-walk target</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[20, 30, 35, 45, 60].map(m => (
                    <button key={m} style={{ ...btn(f.cardioMin === m, true) }} onClick={() => set('cardioMin', m)}>{m} min</button>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: C.textSub, marginTop: 10, lineHeight: 1.5 }}>
                  ~{inclineWalkBurn(f.cardioMin || 35, f.startWeight || 72)} kcal/day at incline (≈5.5 METs). Aggressive total deficit of {ACTIVE_DEFICIT} kcal/day — the more you walk, the more you eat. Log your walk on the Today tab.
                </div>
              </div>
            )}
          </div>
          <div style={card({ background: '#0c0c0f' })}>
            <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Diet Regime</div>
            <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.5 }}>Your daily target is driven by the <strong style={{ color: C.accent }}>Cut IQ</strong> engine. Choose <strong>Steady</strong> (same target daily) or <strong>Zigzag</strong> (varied across the week, same weekly deficit) anytime in the <strong style={{ color: C.accent }}>Schedule</strong> tab. Protein stays locked at 130g.</div>
          </div>
          <div style={card({ background: '#0c0e14' })}>
            <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Manual Calorie Target</div>
            <div style={{ fontSize: 12, color: C.textSub, marginBottom: 14 }}>Override adaptive TDEE with a fixed number. Leave blank to use the calculated target.</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input style={inp({ maxWidth: 160, fontFamily: F.mono })} type="number" inputMode="decimal" value={f.manualCalTarget} placeholder="e.g. 1800" onChange={e => set('manualCalTarget', e.target.value ? +e.target.value : '')} />
              <span style={{ fontSize: 12, color: C.textSub }}>kcal/day</span>
              {f.manualCalTarget && <button style={btn(false, true)} onClick={() => set('manualCalTarget', '')}>Clear</button>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ width: 200 }}><label style={LBL}>Cut Start Date</label><input style={inp()} type="date" value={f.startDate} onChange={e => set('startDate', e.target.value)} /></div>
            <div style={{ width: 160 }}><label style={LBL}>Cut Length (days)</label><input style={inp()} type="number" inputMode="decimal" step="7" value={f.cutLength} placeholder="60" onChange={e => set('cutLength', e.target.value ? +e.target.value : '')} /><div style={{ fontSize: 11, color: C.textSub, marginTop: 6 }}>After this, targets ramp back to maintenance</div></div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button style={{ ...btn(true), flex: 1, fontSize: 15, padding: '13px 0' }} onClick={() => {
              if (!f.age || !f.height || !f.startWeight || !f.startBF) {
                alert('Please fill in Age, Height, Starting Weight, and Starting Body Fat % before continuing.')
                return
              }
              // sanity-check the numbers — goalBF >= startBF or extreme values
              // turn the goal-weight math (lean / (1 - bf)) into garbage/Infinity
              if (f.age < 10 || f.age > 100)            { alert('Age looks off — enter a value between 10 and 100.'); return }
              if (f.height < 100 || f.height > 250)     { alert('Height looks off — enter centimetres (100–250).'); return }
              if (f.startWeight < 30 || f.startWeight > 300) { alert('Start weight looks off — enter kilograms (30–300).'); return }
              if (f.startBF < 3 || f.startBF > 70)      { alert('Starting body fat % must be between 3 and 70.'); return }
              if (!f.goalBF || f.goalBF < 3 || f.goalBF > 60) { alert('Goal body fat % must be between 3 and 60.'); return }
              if (+f.goalBF >= +f.startBF)              { alert('Goal body fat % must be LOWER than your starting body fat % — this is a cutting app.'); return }
              if (!f.cutLength || f.cutLength < 14 || f.cutLength > 365) { alert('Cut length must be between 14 and 365 days.'); return }
              onSave(f)
            }}>{existing ? 'Save Changes' : 'Start My Cut'}</button>
            {existing && <button style={btn()} onClick={onCancel}>Cancel</button>}
          </div>
          {existing && onExport && (
            <div style={{ marginTop: 8, paddingTop: 16, borderTop: `1px solid ${C.borderSoft}` }}>
              <label style={LBL}>Your Data</label>
              <div style={{ display: 'flex', gap: 10 }}>
                <button style={{ ...btn(false), flex: 1 }} onClick={() => onExport('json')}>⬇ Full backup (JSON)</button>
                <button style={{ ...btn(false), flex: 1 }} onClick={() => onExport('csv')}>⬇ Daily logs (CSV)</button>
              </div>
            </div>
          )}
          {existing && onReset && (
            <div style={{ marginTop: 8, paddingTop: 16, borderTop: `1px solid ${C.borderSoft}` }}>
              <button style={{ ...btn(false), width: '100%', color: C.red, borderColor: `${C.red}44`, display:'inline-flex', alignItems:'center', justifyContent:'center', gap:8 }} onClick={onReset}>
                <Icon name="ban" size={15} color={C.red} /> Reset all data & start fresh
              </button>
              <div style={{ fontSize: 11, color: C.textFaint, marginTop: 8, textAlign: 'center' }}>Wipes all logs, workouts, and settings. Cannot be undone.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   HEADER
═══════════════════════════════════════════════════════════════ */
function Header({ dayCount, daysLeft, cutLength = 60, phase = 'cut', latestWeight, goalWeight, streak = 0, onSettings, onLogout }) {
  const mobile = useIsMobile()
  const pct    = Math.min((dayCount / cutLength) * 100, 100)
  return (
    <div style={{ borderBottom: `1px solid ${C.borderSoft}`, background: 'rgba(7,8,9,0.85)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 12 : 18, padding: mobile ? '12px 16px' : '13px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: C.accent, boxShadow: `0 0 10px ${C.accent}` }} />
          <div style={{ fontFamily: F.head, fontWeight: 800, fontSize: mobile ? 15 : 19, color: C.text, letterSpacing: '-0.02em' }}>CUTBOARD</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ height: 5, background: C.borderSoft, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, ${C.accentDim}, ${C.accent})`, borderRadius: 3, boxShadow: `0 0 8px ${C.accent}66`, transition: 'width 0.6s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 5, fontSize: 10, color: C.textSub, fontFamily: F.mono, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
            <span>{phase === 'maintenance' ? (mobile ? `DAY ${dayCount} · MAINT` : `DAY ${dayCount} · MAINTENANCE`) : `DAY ${dayCount} / ${cutLength}`}</span>
            <span>{phase === 'maintenance' ? (mobile ? 'DONE ✓' : 'CUT DONE ✓') : (mobile ? `${daysLeft}D` : `${daysLeft}D LEFT`)}</span>
          </div>
        </div>
        {!mobile && streak >= 2 && (
          <div title={`${streak}-day logging streak`} style={{ display:'inline-flex', alignItems:'center', gap:5, fontFamily: F.mono, fontSize: 12, color: C.orange, flexShrink: 0, background: 'rgba(240,150,77,0.08)', padding: '6px 11px', borderRadius: 10, border: '1px solid rgba(240,150,77,0.25)' }}>
            <Icon name="flame" size={13} color={C.orange} />{streak}
          </div>
        )}
        {!mobile && latestWeight && (
          <div style={{ fontFamily: F.mono, fontSize: 12, color: C.textSub, flexShrink: 0, background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: 10, border: `1px solid ${C.borderSoft}` }}>
            <span style={{ color: C.text }}>{latestWeight}kg</span>
            <span style={{ margin: '0 8px', color: C.textFaint }}>→</span>
            <span style={{ color: C.accent }}>{goalWeight?.toFixed(1)}kg</span>
          </div>
        )}
        <button style={{ ...btn(false, true), padding: mobile ? '7px 11px' : '7px 14px', display:'inline-flex', alignItems:'center', gap:7 }} onClick={onSettings}>
          <Icon name="gear" size={16} />{!mobile && ' Settings'}
        </button>
        <button style={{ ...btn(false, true), padding: mobile ? '7px 11px' : '7px 14px', color: C.textSub, display:'inline-flex', alignItems:'center', gap:7 }} onClick={onLogout}>
          {mobile ? <Icon name="arrowRight" size={16} color={C.textSub} /> : 'Sign Out'}
        </button>
      </div>
      {mobile && (latestWeight || streak >= 2) && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', paddingBottom: 10, fontFamily: F.mono, fontSize: 12, color: C.textSub }}>
          {latestWeight && (<>
            <span style={{ color: C.text }}>{latestWeight}kg</span>
            <span style={{ margin: '0 6px', color: C.textFaint }}>→</span>
            <span style={{ color: C.accent }}>{goalWeight?.toFixed(1)}kg</span>
            <span style={{ marginLeft: 8, color: C.textFaint }}>goal</span>
          </>)}
          {streak >= 2 && <span style={{ display:'inline-flex', alignItems:'center', gap:4, marginLeft: latestWeight ? 12 : 0, color: C.orange }}><Icon name="flame" size={12} color={C.orange} />{streak}d</span>}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   TAB BAR
═══════════════════════════════════════════════════════════════ */
const TABS = [
  {id:'today',     label:'Today',     icon:'clipboard'},
  {id:'nutrition', label:'Nutrition', icon:'apple'},
  {id:'progress',  label:'Progress',  icon:'chart'},
  {id:'cutiq',     label:'Cut IQ',    icon:'target'},
  {id:'plan',      label:'Schedule',  icon:'calendar'},
  {id:'workout',   label:'Workout',   icon:'dumbbell'},
]
function TabBar({ tab, setTab }) {
  const mobile = useIsMobile()
  if (mobile) {
    // Fixed BOTTOM nav — thumb-reach territory. The app root pads its
    // content bottom so nothing hides behind this bar.
    return (
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: 'rgba(10,10,13,0.92)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        borderTop: `1px solid ${C.borderSoft}`, display: 'flex',
        padding: '6px 2px calc(8px + env(safe-area-inset-bottom, 0px))' }}>
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => { setTab(t.id); buzz(8) }}
              style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', fontFamily: F.body,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '5px 0 3px',
                color: active ? C.accent : C.textSub, transition: 'color 0.18s', position: 'relative' }}>
              <span style={{ position: 'absolute', top: -7, width: 18, height: 3, borderRadius: 2,
                background: active ? `linear-gradient(90deg, ${C.accentDim}, ${C.accent})` : 'transparent',
                boxShadow: active ? `0 0 8px ${C.accent}` : 'none', transition: 'all 0.2s' }} />
              <Icon name={t.icon} size={21}
                color={active ? C.accent : C.textSub}
                style={{ filter: active ? `drop-shadow(0 0 7px ${C.accent}77)` : 'none', transform: active ? 'translateY(-1px)' : 'none', transition:'all 0.18s' }} />
              <span style={{ fontSize: 10.5, fontWeight: active ? 700 : 500, letterSpacing: '0.04em' }}>{t.label}</span>
            </button>
          )
        })}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 6, padding: '12px 22px', borderBottom: `1px solid ${C.borderSoft}` }}>
      {TABS.map(t => (
        <button key={t.id} style={{ ...btn(tab === t.id, true), borderRadius: 11, display:'inline-flex', alignItems:'center', gap:7 }} onClick={() => setTab(t.id)}>
          <Icon name={t.icon} size={15} /> {t.label}
        </button>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   TODAY TAB
═══════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════
   TASK PLANNER
═══════════════════════════════════════════════════════════════ */
const PRIORITY_META = {
  high:   { color: C.red,   label: 'High'   },
  medium: { color: C.orange, label: 'Medium' },
  low:    { color: C.blue,  label: 'Low'    },
}

/* Premium circular calorie ring — sweeps in from 0 on mount */
function CalorieRing({ consumed, target, size = 168 }) {
  const stroke = 13
  const r      = (size - stroke) / 2
  const circ   = 2 * Math.PI * r
  const [mounted, setMounted] = useState(false)
  useEffect(() => { const t = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(t) }, [])
  const pct    = mounted ? (target > 0 ? Math.min(consumed / target, 1) : 0) : 0
  const over   = consumed > target
  const remaining = target - consumed
  // Design spec: ring stays accent purple all the way to target; only turns red
  // once you actually go OVER (no intermediate orange "approaching" state).
  const ringColor = over ? C.red : C.accent
  return (
    <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ transform:'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.borderSoft} strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={ringColor} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          style={{ transition:'stroke-dashoffset 0.6s cubic-bezier(.4,0,.2,1), stroke 0.3s', filter:`drop-shadow(0 0 6px ${ringColor}66)` }} />
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
        <div style={{ fontSize:11, color:over?C.red:C.accent, fontWeight:600, marginBottom:1 }}>
          {over ? `+${Math.abs(remaining)} over` : `${remaining} left`}
        </div>
        <div style={{ fontFamily:F.mono, fontSize:size>=160?38:34, fontWeight:700, color:over?C.red:C.text, lineHeight:1.05, letterSpacing:'-0.02em' }}>{consumed}</div>
        <div style={{ fontSize:11, color:C.textSub, marginTop:2 }}>of {target} kcal</div>
      </div>
    </div>
  )
}

function TaskPlanner({ tasks = [], onUpdate }) {
  const mobile = useIsMobile()
  const [addOpen,        setAddOpen]        = useState(false)
  const [newTask,        setNewTask]        = useState({ text:'', target:'', unit:'', priority:'medium' })
  const [editingProgress,setEditingProgress]= useState(null)
  const [progressInput,  setProgressInput]  = useState('')
  const [editingTask,    setEditingTask]    = useState(null)
  const [editForm,       setEditForm]       = useState({})

  const done  = tasks.filter(t => t.done).length
  const total = tasks.length
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0

  const genId = () => `t_${Date.now()}_${Math.random().toString(36).slice(2,6)}`

  const addTask = () => {
    if (!newTask.text.trim()) return
    onUpdate([...tasks, {
      id:       genId(),
      text:     newTask.text.trim(),
      done:     false,
      target:   newTask.target ? +newTask.target : null,
      current:  0,
      unit:     newTask.unit.trim() || null,
      priority: newTask.priority,
    }])
    setNewTask({ text:'', target:'', unit:'', priority:'medium' })
    setAddOpen(false)
  }

  const toggleDone = id => {
    buzz(12)
    onUpdate(tasks.map(t => t.id === id ? { ...t, done: !t.done, current: !t.done && t.target ? t.target : t.current } : t))
  }

  const updateProgress = (id, raw) => {
    const val  = +raw
    const task = tasks.find(t => t.id === id)
    if (!task) return
    onUpdate(tasks.map(t => t.id === id
      ? { ...t, current: val, done: t.target ? val >= t.target : t.done }
      : t
    ))
    setEditingProgress(null)
  }

  const saveEdit = () => {
    onUpdate(tasks.map(t => t.id === editingTask
      ? { ...t, ...editForm, target: editForm.target ? +editForm.target : null }
      : t
    ))
    setEditingTask(null)
  }

  const remove    = id => onUpdate(tasks.filter(t => t.id !== id))
  const moveUp    = i  => { if (i===0) return; const a=[...tasks]; [a[i-1],a[i]]=[a[i],a[i-1]]; onUpdate(a) }
  const moveDown  = i  => { if (i===tasks.length-1) return; const a=[...tasks]; [a[i],a[i+1]]=[a[i+1],a[i]]; onUpdate(a) }

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ fontFamily:F.head, fontWeight:700, fontSize:15 }}>Today's Plan</div>
          {total > 0 && <span style={{ fontFamily:F.mono, fontSize:12, color:C.textSub }}>{done}/{total}</span>}
        </div>
        <button style={btn(true,true)} onClick={() => setAddOpen(o=>!o)}>+ Task</button>
      </div>

      {/* Overall progress */}
      {total > 0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ height:5, background:C.border, borderRadius:3, overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${pct}%`, background: pct===100 ? C.accent : C.purple, borderRadius:3, transition:'width 0.5s ease' }} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:5, fontSize:11 }}>
            <span style={{ color:C.textSub }}>{done} of {total} complete</span>
            <span style={{ color: pct===100 ? C.accent : C.textSub, fontWeight: pct===100 ? 700 : 400 }}>
              {pct===100 ? '✓ All done!' : `${pct}%`}
            </span>
          </div>
        </div>
      )}

      {/* Add task form */}
      {addOpen && (
        <div style={{ background:'rgba(255,255,255,0.02)', borderRadius:10, padding:14, marginBottom:14, border:`1px solid ${C.border}` }}>
          <input
            style={inp({ marginBottom:10, fontSize:14 })}
            value={newTask.text}
            placeholder="e.g. Walk 3k steps, Study for 2 hours, Read 30 pages..."
            onChange={e => setNewTask(p=>({...p,text:e.target.value}))}
            onKeyDown={e => e.key==='Enter' && addTask()}
            autoFocus
          />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
            <div>
              <label style={LBL}>Target (optional)</label>
              <input style={inp({fontSize:13})} type="number" inputMode="decimal" value={newTask.target} placeholder="e.g. 3000" onChange={e=>setNewTask(p=>({...p,target:e.target.value}))} />
            </div>
            <div>
              <label style={LBL}>Unit</label>
              <input style={inp({fontSize:13})} value={newTask.unit} placeholder="steps, pages, min..." onChange={e=>setNewTask(p=>({...p,unit:e.target.value}))} />
            </div>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={LBL}>Priority</label>
            <div style={{ display:'flex', gap:8 }}>
              {Object.entries(PRIORITY_META).map(([key,{color,label}]) => (
                <button key={key} style={{ flex:1, padding:'7px 0', borderRadius:8, border:`1px solid ${newTask.priority===key?color:C.border}`, background:newTask.priority===key?color+'18':'transparent', color:newTask.priority===key?color:C.textSub, cursor:'pointer', fontFamily:F.body, fontSize:12, fontWeight:newTask.priority===key?600:400, transition:'all 0.15s' }}
                  onClick={()=>setNewTask(p=>({...p,priority:key}))}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button style={btn(true,true)} onClick={addTask}>Add Task</button>
            <button style={btn(false,true)} onClick={()=>setAddOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Task list */}
      {tasks.length === 0 ? (
        <div style={{ textAlign:'center', padding:'28px 0', color:C.textSub, fontSize:13 }}>
          No tasks yet — hit "+ Task" to plan your day
        </div>
      ) : (
        <div style={{ display:'grid', gap:8 }}>
          {tasks.map((task, i) => {
            const pmeta   = PRIORITY_META[task.priority] || PRIORITY_META.medium
            const taskPct = task.target && task.current ? Math.min(Math.round((task.current/task.target)*100),100) : 0
            const isEditP = editingProgress === task.id
            const isEditT = editingTask === task.id

            if (isEditT) return (
              <div key={task.id} style={{ background:'rgba(255,255,255,0.02)', borderRadius:10, padding:14, border:`1px solid ${C.accent}33` }}>
                <input style={inp({marginBottom:8,fontSize:14})} value={editForm.text||''} onChange={e=>setEditForm(p=>({...p,text:e.target.value}))} />
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
                  <input style={inp({fontSize:13})} type="number" inputMode="decimal" value={editForm.target||''} placeholder="Target" onChange={e=>setEditForm(p=>({...p,target:e.target.value}))} />
                  <input style={inp({fontSize:13})} value={editForm.unit||''} placeholder="Unit" onChange={e=>setEditForm(p=>({...p,unit:e.target.value}))} />
                </div>
                <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                  {Object.entries(PRIORITY_META).map(([key,{color,label}]) => (
                    <button key={key} style={{ flex:1, padding:'6px 0', borderRadius:8, border:`1px solid ${editForm.priority===key?color:C.border}`, background:editForm.priority===key?color+'18':'transparent', color:editForm.priority===key?color:C.textSub, cursor:'pointer', fontFamily:F.body, fontSize:12 }}
                      onClick={()=>setEditForm(p=>({...p,priority:key}))}>{label}</button>
                  ))}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button style={btn(true,true)} onClick={saveEdit}>Save</button>
                  <button style={btn(false,true)} onClick={()=>setEditingTask(null)}>Cancel</button>
                </div>
              </div>
            )

            return (
              <div key={task.id} style={{ background:task.done?'#0a0d0a':'#0c0e16', borderRadius:10, padding:'12px 14px', border:`1px solid ${task.done?'#1a2f12':C.border}`, transition:'all 0.2s' }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>

                  {/* Checkbox */}
                  <button onClick={()=>toggleDone(task.id)} style={{ flexShrink:0, width:22, height:22, borderRadius:'50%', border:`2px solid ${task.done?C.accent:pmeta.color}`, background:task.done?C.accent:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', marginTop:2, padding:0, transition:'all 0.2s' }}>
                    {task.done && <span style={{ color:'#000', fontSize:11, fontWeight:800, lineHeight:1 }}>✓</span>}
                  </button>

                  {/* Text + progress */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:14, color:task.done?C.textSub:C.text, textDecoration:task.done?'line-through':'none', lineHeight:1.45, wordBreak:'break-word' }}>
                      {task.text}
                    </div>

                    {/* Progress bar for tasks with targets */}
                    {task.target && (
                      <div style={{ marginTop:9 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:4 }}>
                          <span style={{ fontFamily:F.mono, color:pmeta.color }}>
                            {(task.current||0).toLocaleString()} / {task.target.toLocaleString()} {task.unit||''}
                          </span>
                          <span style={{ color: taskPct>=100?C.accent:C.textSub }}>{taskPct}%</span>
                        </div>
                        <div style={{ height:5, background:C.border, borderRadius:3, overflow:'hidden' }}>
                          <div style={{ height:'100%', width:`${taskPct}%`, background:taskPct>=100?C.accent:pmeta.color, borderRadius:3, transition:'width 0.4s ease' }} />
                        </div>
                        {isEditP ? (
                          <div style={{ display:'flex', gap:6, marginTop:7, alignItems:'center' }}>
                            <input style={inp({padding:'5px 10px',fontSize:13,width:120})} type="number" inputMode="decimal" value={progressInput} placeholder="Current value" autoFocus
                              onChange={e=>setProgressInput(e.target.value)}
                              onKeyDown={e=>{ if(e.key==='Enter') updateProgress(task.id, progressInput); if(e.key==='Escape') setEditingProgress(null) }} />
                            <button style={btn(true,true)} onClick={()=>updateProgress(task.id,progressInput)}>✓</button>
                            <button style={btn(false,true)} onClick={()=>setEditingProgress(null)}>✕</button>
                          </div>
                        ) : (
                          <button style={{ marginTop:5, fontSize:11, color:C.textSub, background:'none', border:'none', cursor:'pointer', padding:0, fontFamily:F.body }}
                            onMouseEnter={e=>e.currentTarget.style.color=C.accent}
                            onMouseLeave={e=>e.currentTarget.style.color=C.textSub}
                            onClick={()=>{ setEditingProgress(task.id); setProgressInput(String(task.current||0)) }}>
                            ↑ Update progress
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Priority dot + actions */}
                  <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                    <div style={{ width:7, height:7, borderRadius:'50%', background:pmeta.color, opacity:task.done?0.3:1, flexShrink:0 }} title={pmeta.label} />
                    {!mobile && (
                      <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
                        <button onClick={()=>moveUp(i)} style={{ background:'none', border:'none', color:i===0?C.border:C.textSub, cursor:i===0?'default':'pointer', fontSize:10, padding:'1px 3px', lineHeight:1 }}>▲</button>
                        <button onClick={()=>moveDown(i)} style={{ background:'none', border:'none', color:i===tasks.length-1?C.border:C.textSub, cursor:i===tasks.length-1?'default':'pointer', fontSize:10, padding:'1px 3px', lineHeight:1 }}>▼</button>
                      </div>
                    )}
                    <button onClick={()=>{ setEditingTask(task.id); setEditForm({text:task.text,target:task.target||'',unit:task.unit||'',priority:task.priority}) }}
                      style={{ background:'none', border:'none', color:C.textSub, cursor:'pointer', fontSize:14, padding:'2px 4px', lineHeight:1 }}
                      onMouseEnter={e=>e.currentTarget.style.color=C.accent}
                      onMouseLeave={e=>e.currentTarget.style.color=C.textSub}>✎</button>
                    <button onClick={()=>remove(task.id)}
                      style={{ background:'none', border:'none', color:C.textSub, cursor:'pointer', fontSize:18, padding:'2px 4px', lineHeight:1 }}
                      onMouseEnter={e=>e.currentTarget.style.color=C.red}
                      onMouseLeave={e=>e.currentTarget.style.color=C.textSub}>×</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   FOOD PICKER — search DB, set weight, auto-calc macros
═══════════════════════════════════════════════════════════════ */
const UNIT_LABEL = { g:'grams', ml:'ml', piece:'pieces', scoop:'scoops', cup:'cups', tbsp:'tbsp', serving:'servings' }

function FoodPicker({ customFoods = [], recipes = [], onPick, onAddCustom, onClose }) {
  const mobile = useIsMobile()
  const [search, setSearch] = useState('')
  const [cat, setCat]       = useState('All')
  const [selected, setSelected] = useState(null)
  const [amount, setAmount] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [editingId, setEditingId] = useState(null)  // id of food being edited (null = new)
  const [cf, setCf] = useState({ name:'', kcal:'', protein:'', carbs:'', fat:'', fiber:'', micros:'', unit:'g' })

  // custom foods override built-ins with the same id
  const overrides = Object.fromEntries(customFoods.map(f => [f.id, f]))
  const merged = FOOD_DB.map(f => overrides[f.id] || f)
  const customOnly = customFoods.filter(f => !FOOD_DB.some(b => b.id === f.id))
  // saved recipes surface as one-tap foods, per serving
  const recipeFoods = recipes.map(r => ({
    id: r.id, name: r.name, cat: 'My Meals',
    kcal: r.perServing.cals, protein: r.perServing.protein, fiber: r.perServing.fiber || 0,
    unit: 'serving', isRecipe: true, recipe: r,
  }))
  const allFoods = [...recipeFoods, ...merged, ...customOnly]
  const cats = recipes.length ? ['All', 'My Meals', ...FOOD_CATS] : ['All', ...FOOD_CATS]
  const list = allFoods.filter(f =>
    (cat==='All' || f.cat===cat) && f.name.toLowerCase().includes(search.toLowerCase())
  )

  // default amount when selecting
  const selectFood = f => {
    setSelected(f)
    setAmount(f.unit==='g'||f.unit==='ml' ? '100' : '1')
  }

  // open editor pre-filled with a food's current values
  const editFood = (f, e) => {
    e.stopPropagation()
    setEditingId(f.id)
    setCf({ name:f.name, kcal:String(f.kcal), protein:String(f.protein), carbs:String(f.carbs), fat:String(f.fat), fiber:String(f.fiber||0), micros:f.micros ? JSON.stringify(f.micros) : '', unit:f.unit })
    setShowCustom(true)
  }

  const macros = selected && amount ? (
    selected.isRecipe
      ? (() => { const m = mealFromRecipe(selected.recipe, +amount); return { cals: m.cals, protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber, grams: null } })()
      : computeFoodMacros(selected, +amount)
  ) : null

  const confirmAdd = () => {
    if (!selected || !amount) return
    onPick(selected.isRecipe ? mealFromRecipe(selected.recipe, +amount) : mealFromFood(selected, +amount))
  }

  const saveCustom = () => {
    if (!cf.name || !cf.kcal) return
    const orig = editingId ? allFoods.find(f => f.id === editingId) : null
    let micros = undefined
    if (cf.micros.trim()) {
      try { micros = JSON.parse(cf.micros); if (!micros || typeof micros !== 'object' || Array.isArray(micros)) throw new Error('invalid') }
      catch { alert('Micronutrients must be valid JSON, e.g. {"zinc_mg": 2.1}'); return }
    }
    const food = {
      id: editingId || `custom_${Date.now()}`,
      name: cf.name.trim(),
      cat: orig?.cat || 'Custom',
      kcal:+cf.kcal, protein:+cf.protein||0, carbs:+cf.carbs||0, fat:+cf.fat||0, fiber:+cf.fiber||0,
      unit:cf.unit, ...(orig?.perUnit ? { perUnit: orig.perUnit } : {}), ...(micros ? { micros } : {}), custom:true
    }
    onAddCustom?.(food)
    setShowCustom(false); setEditingId(null); setCf({ name:'', kcal:'', protein:'', carbs:'', fat:'', fiber:'', micros:'', unit:'g' })
    selectFood(food)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'#000b', zIndex:600, display:'flex', alignItems:'flex-end' }} onClick={e=>e.target===e.currentTarget&&onClose()}>

      <div style={{ background:C.bg, width:'100%', maxHeight:'90vh', borderRadius:'20px 20px 0 0', display:'flex', flexDirection:'column', overflow:'hidden', border:`1px solid ${C.border}` }}>
        {/* Header */}
        <div style={{ padding:'16px 18px', borderBottom:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div style={{ fontFamily:F.head, fontWeight:700, fontSize:16 }}>{showCustom ? (editingId ? 'Edit Food' : 'Add Custom Food') : 'Food Database'}</div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.textSub, cursor:'pointer', fontSize:24, lineHeight:1 }}>×</button>
        </div>

        {showCustom ? (
          /* ── Custom food form ── */
          <div style={{ padding:18, overflowY:'auto' }}>
            <div style={{ fontSize:12, color:C.textSub, marginBottom:14, lineHeight:1.5 }}>Add nutrition per <strong style={{color:C.accent}}>100g</strong> (or per piece/scoop). It'll be saved to your database for next time.</div>
            <div style={{ marginBottom:12 }}><label style={LBL}>Food name</label><input style={inp()} value={cf.name} placeholder="e.g. Homemade protein bar" onChange={e=>setCf(p=>({...p,name:e.target.value}))} autoFocus /></div>
            <div style={{ marginBottom:12 }}>
              <label style={LBL}>Measured in</label>
              <div style={{ display:'flex', gap:6 }}>
                {['g','ml','piece','scoop'].map(u=>(
                  <button key={u} style={{...btn(cf.unit===u,true),flex:1,fontSize:12}} onClick={()=>setCf(p=>({...p,unit:u}))}>{u}</button>
                ))}
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
              {[{k:'kcal',l:`Calories per ${cf.unit==='g'||cf.unit==='ml'?'100'+cf.unit:cf.unit}`},{k:'protein',l:'Protein (g)'},{k:'carbs',l:'Carbs (g)'},{k:'fat',l:'Fat (g)'},{k:'fiber',l:'Fibre (g)'}].map(({k,l})=>(
                <div key={k}><label style={LBL}>{l}</label><input style={inp()} type="number" inputMode="decimal" value={cf[k]} onChange={e=>setCf(p=>({...p,[k]:e.target.value}))} /></div>
              ))}
            </div>
            <div style={{ marginBottom:16 }}>
              <label style={LBL}>Micronutrients JSON (optional, per 100g/unit)</label>
              <textarea style={inp({ minHeight:72, fontFamily:F.mono, fontSize:12 })} value={cf.micros} placeholder='{"zinc_mg": 2.1, "iron_mg": 4.2, "pantothenic_acid_mg": 1.1, "biotin_ug": 10}' onChange={e=>setCf(p=>({...p,micros:e.target.value}))} />
              <div style={{fontSize:10.5,color:C.textFaint,marginTop:5,lineHeight:1.4}}>Use the nutrient IDs shown in the nutrient coach. Blank means micronutrient data is unknown.</div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button style={btn(true,true)} onClick={saveCustom}>{editingId ? 'Save Changes' : 'Save to Database'}</button>
              <button style={btn(false,true)} onClick={()=>{setShowCustom(false);setEditingId(null)}}>Back</button>
            </div>
            {editingId && <div style={{ fontSize:11, color:C.textFaint, marginTop:10 }}>Edits are shared with all users and override the built-in values.</div>}
          </div>
        ) : selected ? (
          /* ── Amount entry for selected food ── */
          <div style={{ padding:18, overflowY:'auto' }}>
            <button onClick={()=>setSelected(null)} style={{ background:'none', border:'none', color:C.textSub, cursor:'pointer', fontSize:13, marginBottom:14, padding:0 }}>← Back to list</button>
            <div style={{ fontFamily:F.head, fontWeight:700, fontSize:18, marginBottom:4 }}>{selected.name}</div>
            <div style={{ fontSize:12, color:C.textSub, marginBottom:18 }}>{selected.cat} · {selected.kcal} kcal / {selected.unit==='g'||selected.unit==='ml'?`100${selected.unit}`:selected.unit}{selected.perUnit?` (~${selected.perUnit}g)`:''}</div>

            <label style={LBL}>How much? ({UNIT_LABEL[selected.unit]})</label>
            <input style={inp({ fontSize:20, fontFamily:F.mono, textAlign:'center', marginBottom:8 })} type="number" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} autoFocus />
            {/* quick chips */}
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:18 }}>
              {(selected.isRecipe ? [0.5,1,1.5,2] : selected.unit==='g'||selected.unit==='ml' ? [50,100,150,200,250] : [1,2,3,4]).map(q=>(
                <button key={q} style={{...btn(+amount===q,true),fontSize:12,padding:'5px 12px'}} onClick={()=>setAmount(String(q))}>{q}{selected.unit==='g'||selected.unit==='ml'?selected.unit:''}</button>
              ))}
            </div>

            {macros && (
              <div style={{ background:'rgba(167,139,250,0.08)', border:`1px solid ${C.accent}33`, borderRadius:14, padding:16, marginBottom:16 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:12 }}>
                  <span style={{ fontSize:12, color:C.textSub }}>{macros.grams!=null ? `${macros.grams}g total` : `${amount} serving${+amount===1?'':'s'}`}</span>
                  <span style={{ fontFamily:F.mono, fontSize:26, fontWeight:700, color:C.accent }}>{macros.cals} <span style={{fontSize:13}}>kcal</span></span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
                  {[['Protein',macros.protein,C.protein],['Carbs',macros.carbs,C.carbs],['Fat',macros.fat,C.fat],['Fibre',macros.fiber,C.fiber]].map(([l,v,c])=>(
                    <div key={l} style={{ textAlign:'center', background:'rgba(255,255,255,0.03)', borderRadius:10, padding:'9px 4px' }}>
                      <div style={{ fontFamily:F.mono, fontSize:15, fontWeight:700, color:c }}>{v}g</div>
                      <div style={{ fontSize:10, color:C.textSub, marginTop:2 }}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button style={{...btn(true),width:'100%'}} onClick={confirmAdd}>Add to Today</button>
          </div>
        ) : (
          /* ── Food list ── */
          <>
            <div style={{ padding:'12px 18px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
              <input style={{ ...inp(), marginBottom:10 }} placeholder="Search foods…" value={search} onChange={e=>setSearch(e.target.value)} autoFocus />
              <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:2 }}>
                {cats.map(c=>(
                  <button key={c} style={{...btn(cat===c,true),whiteSpace:'nowrap',flexShrink:0,fontSize:12}} onClick={()=>setCat(c)}>{c}</button>
                ))}
              </div>
            </div>
            <div style={{ overflowY:'auto', flex:1 }}>
              {list.map(f=>(
                <div key={f.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', width:'100%', padding:'11px 18px', borderBottom:`1px solid ${C.borderSoft}` }}
                  onMouseEnter={e=>e.currentTarget.style.background=C.surface} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                  <div onClick={()=>selectFood(f)} style={{ flex:1, cursor:'pointer' }}>
                    <div style={{ display:'flex', alignItems:'center', fontSize:14, color:C.text }}>{f.isRecipe&&<Icon name="apple" size={12} color={C.accent} style={{marginRight:5}} />}{f.name}{f.custom&&<span style={{fontSize:10,color:C.accent,marginLeft:6}}>★</span>}</div>
                    <div style={{ fontSize:11, color:C.textSub, marginTop:2 }}>{f.cat} · {f.protein}g P · {f.fiber||0}g fibre / {f.unit==='g'||f.unit==='ml'?`100${f.unit}`:f.unit}</div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                    <span onClick={()=>selectFood(f)} style={{ fontFamily:F.mono, fontSize:13, color:C.accent, cursor:'pointer' }}>{f.kcal}</span>
                    {!f.isRecipe && <button onClick={(e)=>editFood(f,e)} style={{ background:'none', border:'none', color:C.textFaint, cursor:'pointer', fontSize:14, padding:'4px 2px' }}
                      onMouseEnter={e=>e.currentTarget.style.color=C.accent} onMouseLeave={e=>e.currentTarget.style.color=C.textFaint}>✎</button>}
                  </div>
                </div>
              ))}
              {list.length===0 && <div style={{ textAlign:'center', padding:'40px 20px', color:C.textSub, fontSize:13 }}>No foods found</div>}
            </div>
            <div style={{ padding:'12px 18px', borderTop:`1px solid ${C.border}`, flexShrink:0 }}>
              <button style={{...btn(false,true),width:'100%',borderStyle:'dashed'}} onClick={()=>setShowCustom(true)}>+ Add Custom Food to Database</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   RECIPE BUILDER — assemble a dish from DB foods, saved per-serving
═══════════════════════════════════════════════════════════════ */
function RecipeBuilder({ recipe, customFoods = [], onSave, onClose }) {
  const [name,     setName]     = useState(recipe?.name || '')
  const [servings, setServings] = useState(recipe?.servings || 1)
  const [items,    setItems]    = useState(recipe?.items || [])   // [{foodId, name, unit, amount}]
  const [search,   setSearch]   = useState('')

  const overrides  = Object.fromEntries(customFoods.map(f => [f.id, f]))
  const merged     = FOOD_DB.map(f => overrides[f.id] || f)
  const customOnly = customFoods.filter(f => !FOOD_DB.some(b => b.id === f.id))
  const allFoods   = [...merged, ...customOnly]
  const foodById   = Object.fromEntries(allFoods.map(f => [f.id, f]))

  const results = search.trim()
    ? allFoods.filter(f => f.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : []

  const addItem    = f => { setItems(p => [...p, { foodId: f.id, name: f.name, unit: f.unit, amount: f.unit === 'g' || f.unit === 'ml' ? 100 : 1 }]); setSearch('') }
  const setAmount  = (i, v) => setItems(p => p.map((x, j) => j === i ? { ...x, amount: v } : x))
  const removeItem = i => setItems(p => p.filter((_, j) => j !== i))

  const itemMacros = it => {
    const f = foodById[it.foodId]
    return f && +it.amount > 0 ? computeFoodMacros(f, +it.amount) : null
  }
  const totals = items.reduce((t, it) => {
    const m = itemMacros(it); if (!m) return t
    return { cals: t.cals + m.cals, protein: t.protein + m.protein, carbs: t.carbs + m.carbs, fat: t.fat + m.fat, fiber: t.fiber + m.fiber, micros: addMicros(t.micros, m.micros) }
  }, { cals: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, micros: {} })
  const sv  = Math.max(1, +servings || 1)
  const ps1 = x => Math.round(x / sv * 10) / 10
  const perServing = { cals: Math.round(totals.cals / sv), protein: ps1(totals.protein), carbs: ps1(totals.carbs), fat: ps1(totals.fat), fiber: ps1(totals.fiber), micros: Object.fromEntries(Object.entries(totals.micros).map(([k,v]) => [k, ps1(v)])) }
  const canSave = name.trim() && items.length > 0 && totals.cals > 0

  const save = () => {
    if (!canSave) return
    onSave({ id: recipe?.id || `recipe_${Date.now()}`, name: name.trim(), servings: sv, items: items.map(i => ({ ...i, amount: +i.amount })), perServing })
    onClose()
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'#000b', zIndex:600, display:'flex', alignItems:'flex-end' }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:C.bg, width:'100%', maxHeight:'92vh', borderRadius:'20px 20px 0 0', display:'flex', flexDirection:'column', overflow:'hidden', border:`1px solid ${C.border}` }}>
        <div style={{ padding:'16px 18px', borderBottom:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div style={{ fontFamily:F.head, fontWeight:700, fontSize:16 }}>{recipe ? 'Edit Meal' : 'Build a Meal'}</div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.textSub, cursor:'pointer', fontSize:24, lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:18, overflowY:'auto', flex:1 }}>
          <div style={{ marginBottom:14 }}><label style={LBL}>Meal name</label>
            <input style={inp()} value={name} placeholder="e.g. Dal-rice-ghee bowl" onChange={e=>setName(e.target.value)} autoFocus={!recipe} /></div>

          {/* ingredients */}
          {items.length > 0 && (
            <div style={{ display:'grid', gap:8, marginBottom:14 }}>
              {items.map((it, i) => {
                const m = itemMacros(it)
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:'rgba(255,255,255,0.02)', border:`1px solid ${C.borderSoft}`, borderRadius:10, padding:'8px 10px' }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{it.name}</div>
                      {m && <div style={{ fontSize:10.5, color:C.textSub, marginTop:1 }}>{m.cals} kcal · {m.protein}g P</div>}
                    </div>
                    <input style={inp({ width:72, textAlign:'center', fontFamily:F.mono, padding:'6px 8px', fontSize:13 })} type="number" inputMode="decimal" value={it.amount}
                      onChange={e=>setAmount(i, e.target.value)} />
                    <span style={{ fontSize:11, color:C.textSub, width:46 }}>{it.unit==='g'||it.unit==='ml'?it.unit:UNIT_LABEL[it.unit]||it.unit}</span>
                    <button onClick={()=>removeItem(i)} style={{ background:'none', border:'none', color:C.textSub, cursor:'pointer', fontSize:17, padding:'2px 4px', lineHeight:1 }}>×</button>
                  </div>
                )
              })}
            </div>
          )}

          {/* add ingredient */}
          <div style={{ marginBottom:14 }}>
            <label style={LBL}>Add ingredient</label>
            <input style={inp()} value={search} placeholder="Search the food database…" onChange={e=>setSearch(e.target.value)} />
            {results.length > 0 && (
              <div style={{ border:`1px solid ${C.border}`, borderRadius:12, marginTop:6, overflow:'hidden' }}>
                {results.map(f => (
                  <div key={f.id} onClick={()=>addItem(f)} style={{ display:'flex', justifyContent:'space-between', padding:'10px 12px', borderBottom:`1px solid ${C.borderSoft}`, cursor:'pointer' }}
                    onMouseEnter={e=>e.currentTarget.style.background=C.surface} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                    <span style={{ fontSize:13 }}>{f.name}{f.custom&&<span style={{fontSize:10,color:C.accent,marginLeft:5}}>★</span>}</span>
                    <span style={{ fontFamily:F.mono, fontSize:12, color:C.accent }}>{f.kcal} kcal</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
            <div><label style={LBL}>Makes (servings)</label>
              <input style={inp({ width:90, textAlign:'center', fontFamily:F.mono })} type="number" inputMode="decimal" min="1" value={servings} onChange={e=>setServings(e.target.value)} /></div>
            <div style={{ fontSize:11, color:C.textSub, lineHeight:1.5, flex:1, paddingTop:16 }}>If this batch makes 2 servings, macros below are per serving.</div>
          </div>

          {/* per-serving totals */}
          {items.length > 0 && (
            <div style={{ background:'rgba(167,139,250,0.08)', border:`1px solid ${C.accent}33`, borderRadius:14, padding:14, marginBottom:16 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:10 }}>
                <span style={{ fontSize:11, color:C.textSub, textTransform:'uppercase', letterSpacing:'0.08em' }}>Per serving</span>
                <span style={{ fontFamily:F.mono, fontSize:22, fontWeight:700, color:C.accent }}>{perServing.cals} <span style={{fontSize:12}}>kcal</span></span>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
                {[['Protein',perServing.protein,C.protein],['Carbs',perServing.carbs,C.carbs],['Fat',perServing.fat,C.fat],['Fibre',perServing.fiber,C.fiber]].map(([l,v,c])=>(
                  <div key={l} style={{ textAlign:'center', background:'rgba(255,255,255,0.03)', borderRadius:10, padding:'8px 4px' }}>
                    <div style={{ fontFamily:F.mono, fontSize:14, fontWeight:700, color:c }}>{v}g</div>
                    <div style={{ fontSize:10, color:C.textSub, marginTop:2 }}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display:'flex', gap:8 }}>
            <button style={{ ...btn(canSave), flex:1, opacity:canSave?1:0.4 }} onClick={save}>{recipe ? '✓ Save Changes' : '✓ Save Meal'}</button>
            <button style={btn(false)} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TodayTab({ log, dayPlan, adaptiveTDEE, onSave, setup, allLogs, mealHistory = [], onSaveMealHistory, planSettings, zigzagSettings = {}, stepTarget, cardioPlan, viewDate, onChangeDate, customFoods = [], onSaveCustomFood, recipes = [], streaks }) {
  const [local,        setLocal]        = useState(log)
  const [addOpen,      setAddOpen]      = useState(false)
  const [copyDayOpen,  setCopyDayOpen]  = useState(false)
  const [copySourceDate, setCopySourceDate] = useState(() => addDaysStr(viewDate, -1))
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(viewDate + 'T12:00:00'))
  const [foodPickerOpen, setFoodPickerOpen] = useState(false)
  const [mealsExpanded, setMealsExpanded] = useState(false)
  const [coachOpen,     setCoachOpen]     = useState(false)
  const [mf,           setMf]           = useState({ name:'', cals:'', protein:'', carbs:'', fat:'', fiber:'' })
  const [historySearch,setHistorySearch]= useState('')
  const [editIdx,      setEditIdx]      = useState(null)
  const [editForm,     setEditForm]     = useState({})
  const [toast,        setToast]        = useState(null)   // {msg, undo}
  const toastTimer = useRef(null)
  const mealsRef   = useRef(null)
  useEffect(() => setLocal(log), [log])
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  const showToast = (msg, undo) => {
    clearTimeout(toastTimer.current)
    setToast({ msg, undo })
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }

  const upd = (k, v) => { const next = { ...local, [k]: v }; setLocal(next); onSave(next) }

  // food lookup (custom overrides win) — lets DB-logged meals be re-edited
  // by amount with macros recomputed, instead of retyping all five numbers
  const foodById = useMemo(() => {
    const overrides = Object.fromEntries(customFoods.map(f => [f.id, f]))
    const map = {}
    FOOD_DB.forEach(f => { map[f.id] = overrides[f.id] || f })
    customFoods.forEach(f => { if (!map[f.id]) map[f.id] = f })
    return map
  }, [customFoods])
  const recipeById = useMemo(() => Object.fromEntries(recipes.map(r => [r.id, r])), [recipes])

  const stepData  = useMemo(() => viewDate === todayStr()
    ? getDynamicStepGoal(setup, allLogs, adaptiveTDEE, planSettings, zigzagSettings, stepTarget, local, dayPlan)
    : { goal: setup?.stepGoal || 10000, extra: 0, reason: null },
  [setup, allLogs, adaptiveTDEE, planSettings, zigzagSettings, stepTarget, local, dayPlan, viewDate])
  const zone2Sessions = Array.isArray(local.zone2Sessions) ? local.zone2Sessions : []
  const zone2WeekStart = (() => {
    const d = new Date(viewDate + 'T12:00:00')
    return addDaysStr(viewDate, -d.getDay())
  })()
  const zone2WeekLogs = allLogs.map(l => l.date === local.date ? local : l).filter(l => l.date >= zone2WeekStart && l.date <= addDaysStr(zone2WeekStart, 6))
  const zone2WeekCompleted = zone2WeekLogs.reduce((sum, l) => sum + (Array.isArray(l.zone2Sessions) ? l.zone2Sessions.length : 0), 0)
  const zone2WeekMinutes = zone2WeekLogs.reduce((sum, l) => sum + (Array.isArray(l.zone2Sessions) ? l.zone2Sessions.reduce((total, minutes) => total + (+minutes || 0), 0) : 0), 0)
  const addZone2Session = minutes => upd('zone2Sessions', [...zone2Sessions, minutes])
  const removeZone2Session = () => zone2Sessions.length && upd('zone2Sessions', zone2Sessions.slice(0, -1))

  // ── ALL targets come from dayPlan (the single source of truth) ──
  const regime          = dayPlan.regime
  const isFasting        = dayPlan.fasting.isFasting
  const isPlannedFast    = dayPlan.fasting.planned
  const effectiveMacros  = { calTarget: dayPlan.eatTarget, proteinG: dayPlan.proteinG, carbG: dayPlan.carbG, fatG: dayPlan.fatG, fiberG: dayPlan.fiberG }
  const calTarget        = dayPlan.eatTarget
  const fastCompTarget   = dayPlan.fasting.kind === 'comp25' ? dayPlan.eatTarget : 0

  const insights = useMemo(() => getCoachInsights(setup, allLogs, local, adaptiveTDEE, regime, effectiveMacros, stepData, viewDate === todayStr(), streaks),
    [setup, allLogs, local, adaptiveTDEE, regime, effectiveMacros, stepData, viewDate, streaks])

  const r1 = n => Math.round(n * 10) / 10
  const totalCals    = Math.round(local.meals.reduce((s, m) => s + (+m.cals || 0), 0))
  const totalProtein = r1(local.meals.reduce((s, m) => s + (+m.protein || 0), 0))
  const totalCarbs   = r1(local.meals.reduce((s, m) => s + (+m.carbs || 0), 0))
  const totalFat     = r1(local.meals.reduce((s, m) => s + (+m.fat || 0), 0))
  const totalFiber   = r1(local.meals.reduce((s, m) => s + (+m.fiber || 0), 0))
  const remaining    = calTarget > 0 ? calTarget - totalCals : 0
  const pct          = calTarget > 0 ? Math.min((totalCals / calTarget) * 100, 100) : 0

  const addMeal = () => {
    if (!mf.name || !mf.cals) return
    const meal = { name: mf.name, cals: +mf.cals, protein: +mf.protein||0, carbs: +mf.carbs||0, fat: +mf.fat||0, fiber: +mf.fiber||0 }
    const next = { ...local, meals: [...local.meals, meal] }
    setLocal(next); onSave(next); onSaveMealHistory?.(meal); buzz(12)
    setMf({ name:'', cals:'', protein:'', carbs:'', fat:'', fiber:'' }); setHistorySearch(''); setAddOpen(false)
  }
  const quickAdd = (meal) => {
    const m = { name: meal.name, cals: +meal.cals, protein: +meal.protein||0, carbs: +meal.carbs||0, fat: +meal.fat||0, fiber: +meal.fiber||0,
      ...(meal.foodId ? { foodId: meal.foodId, amount: meal.amount } : {}),
      ...(meal.recipeId ? { recipeId: meal.recipeId, amount: meal.amount } : {}),
      ...(meal.micros ? { micros: meal.micros } : {}) }
    const next = { ...local, meals: [...local.meals, m] }
    setLocal(next); onSave(next); onSaveMealHistory?.(m); buzz(12)
  }
  const removeMeal = idx => {
    const removed = local.meals[idx]
    const next = { ...local, meals: local.meals.filter((_,i) => i!==idx) }
    setLocal(next); onSave(next); buzz(10)
    showToast(`Removed ${removed.name}`, () => {
      const restored = { ...next, meals: [...next.meals.slice(0, idx), removed, ...next.meals.slice(idx)] }
      setLocal(restored); onSave(restored); setToast(null)
    })
  }
  const dupMeal    = idx => { const next = { ...local, meals: [...local.meals, { ...local.meals[idx] }] }; setLocal(next); onSave(next); buzz(12) }
  const copySourceLog = copySourceDate === viewDate ? local : allLogs.find(l => l.date === copySourceDate)
  const calendarCells = useMemo(() => {
    const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1, 12)
    const start = new Date(first)
    start.setDate(first.getDate() - first.getDay())
    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(start)
      date.setDate(start.getDate() + i)
      return localDateStr(date)
    })
  }, [calendarMonth])
  const calendarLogFor = date => date === viewDate ? local : allLogs.find(l => l.date === date)
  const calendarCalsFor = date => Math.round((calendarLogFor(date)?.meals || []).reduce((sum, meal) => sum + (+meal.cals || 0), 0))
  const calendarTargetFor = date => {
    const dayLog = calendarLogFor(date)
    return dayLog?.planSnapshot?.eatTarget ?? getPlanForDate({ date, log:dayLog, setup, logs:allLogs, planSettings, zigzagSettings }).eatTarget
  }
  const calendarCalsColor = (date, cals, hasMeals) => {
    if (!hasMeals) return C.textFaint
    return cals <= calendarTargetFor(date) + 75 ? C.good : C.bad
  }
  const copyMealsFromDay = () => {
    if (copySourceDate === viewDate || !copySourceLog?.meals?.length) return
    const next = { ...local, meals: [...local.meals, ...copySourceLog.meals.map(m => ({ ...m }))] }
    setLocal(next); onSave(next); setCopyDayOpen(false); buzz(12)
  }
  const yesterdayLog = allLogs.find(l => l.date === addDaysStr(viewDate, -1))
  const copyYesterday = () => {
    if (!yesterdayLog?.meals?.length) return
    const next = { ...local, meals: [...local.meals, ...yesterdayLog.meals.map(m => ({ ...m }))] }
    setLocal(next); onSave(next)
  }
  const startEdit = idx => {
    const m = local.meals[idx]
    setEditIdx(idx)
    // DB-logged meal (food OR saved recipe) → edit by AMOUNT, macros recompute
    const smart = m.amount != null && ((m.foodId && foodById[m.foodId]) || (m.recipeId && recipeById[m.recipeId]))
    setEditForm(smart ? { smart: true, amount: String(m.amount) } : { smart: false, ...m })
  }
  const saveEdit = () => {
    const m = local.meals[editIdx]
    let replacement
    if (editForm.smart) {
      if (!editForm.amount || +editForm.amount <= 0) return
      replacement = m.recipeId
        ? mealFromRecipe(recipeById[m.recipeId], +editForm.amount)
        : mealFromFood(foodById[m.foodId], +editForm.amount)
    } else {
      replacement = { name: editForm.name, cals: +editForm.cals||0, protein: +editForm.protein||0, carbs: +editForm.carbs||0, fat: +editForm.fat||0, fiber: +editForm.fiber||0 }
    }
    const updated = local.meals.map((x, i) => i === editIdx ? replacement : x)
    const next = { ...local, meals: updated }; setLocal(next); onSave(next); setEditIdx(null)
  }
  const toggleFasting = () => {
    // planned-day check must use the VIEWED date's weekday, not real today
    const isPlannedDay = planSettings?.fastingDays?.includes(new Date(viewDate + 'T12:00:00').getDay())
    if (isFasting) {
      // Turn off fasting — keep override flag if this is a planned day to prevent re-activation
      const next = { ...local, fasting: false, fastingOverridden: isPlannedDay, meals: local.meals }
      setLocal(next); onSave(next)
    } else {
      // Turn on manual fast
      const next = { ...local, fasting: true, fastingOverridden: false, meals: [] }
      setLocal(next); onSave(next); setAddOpen(false)
    }
  }

  const mobile = useIsMobile()
  const isToday = viewDate === todayStr()
  const shiftDay = delta => {
    const ns = addDaysStr(viewDate, delta)
    if (ns <= todayStr()) onChangeDate(ns)
  }
  const niceDate = (() => {
    if (isToday) return 'Today'
    if (viewDate === addDaysStr(todayStr(), -1)) return 'Yesterday'
    return new Date(viewDate + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })
  })()

  return (
    <div style={{ padding: mobile ? 12 : 20, display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: mobile ? 10 : 16, maxWidth: 980, margin: '0 auto' }}>

      {/* Date navigator */}
      <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <button onClick={() => shiftDay(-1)} style={{ ...btn(false, true), padding: '8px 14px', fontSize: 16, lineHeight: 1 }}>‹</button>
        <div style={{ textAlign: 'center', minWidth: mobile ? 140 : 180 }}>
          <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 16, color: isToday ? C.accent : C.text }}>{niceDate}</div>
          {!isToday && <button onClick={() => onChangeDate(todayStr())} style={{ background: 'none', border: 'none', color: C.textSub, fontSize: 11, cursor: 'pointer', marginTop: 2, fontFamily: F.body }}>↩ Jump to today</button>}
        </div>
        <button onClick={() => shiftDay(1)} disabled={isToday} style={{ ...btn(false, true), padding: '8px 14px', fontSize: 16, lineHeight: 1, opacity: isToday ? 0.3 : 1, cursor: isToday ? 'default' : 'pointer' }}>›</button>
      </div>

      {/* Calorie Hero — ring + macro stats */}
      <div style={{ ...card({ padding: mobile ? '20px 18px' : '22px 24px', background:'linear-gradient(165deg,#17131f 0%,#0f0d14 100%)', border:`1px solid #2a2433`, borderRadius:RADIUS.hero, boxShadow:`0 1px 2px rgba(0,0,0,0.5), 0 16px 40px -18px ${C.accentGlow}59` }), gridColumn: '1/-1' }}>
        {isFasting ? (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:18, padding:'14px 0', flexWrap:'wrap' }}>
            <Icon name="ban" size={44} color={C.blue} />
            <div>
              <div style={{ fontFamily:F.head, fontWeight:800, fontSize:24, color:C.blue }}>
                {isPlannedFast && !local.fasting ? 'Planned Fasting Day' : 'Fasting Day'}
              </div>
              <div style={{ fontSize:13, color:C.textSub, marginTop:4 }}>
                {planSettings?.fastCompensation && fastCompTarget > 0
                  ? `25% compensation — ${fastCompTarget} kcal target`
                  : '0 kcal — full deficit locked in'}
              </div>
            </div>
            {(!planSettings?.fastCompensation || !fastCompTarget) && (
              <div style={{ marginLeft:12, textAlign:'center', paddingLeft:18, borderLeft:`1px solid ${C.border}` }}>
                <div style={{ fontFamily:F.mono, fontSize:30, fontWeight:700, color:C.accent }}>−{dayPlan.deficit}</div>
                <div style={{ fontSize:10.5, color:C.textSub, textTransform:'uppercase', letterSpacing:'0.1em', marginTop:4 }}>kcal deficit today</div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display:'flex', alignItems:'center', gap: mobile ? 18 : 28 }}>
            <CalorieRing consumed={totalCals} target={calTarget} size={mobile ? 138 : 168} />
            <div style={{ flex:1, minWidth:0, display:'grid', gap:13 }}>
              {[
                { label:'Protein', color:C.protein, cur:totalProtein, tgt:effectiveMacros.proteinG },
                { label:'Carbs',   color:C.carbs,   cur:totalCarbs,   tgt:effectiveMacros.carbG },
                { label:'Fat',     color:C.fat,     cur:totalFat,     tgt:effectiveMacros.fatG },
              ].map(({label,color,cur,tgt}) => (
                <div key={label}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:5 }}>
                    <span style={{ fontSize:12, color:C.textSub }}>{label}</span>
                    <span style={{ fontFamily:F.mono, fontSize:13, color }}>{cur}<span style={{ color:C.textFaint }}>/{tgt}g</span></span>
                  </div>
                  <div style={{ height:BAR.h, background:BAR.track, borderRadius:3, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${tgt>0?Math.min((cur/tgt)*100,100):0}%`, background:color, borderRadius:3, transition:'width 0.4s' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Coach Panel — pairs beside Vitals on desktop (full-width on mobile) */}
      <div style={card()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Icon name="sparkle" size={17} color={C.accent} />
          <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15 }}>Coach</div>
          <div style={{ flex: 1 }} />
          {regime === 'zigzag' && <span style={{ background: 'rgba(167,139,250,0.12)', border: `1px solid ${C.accent}44`, color: C.accent, fontSize: 10, fontWeight: 700, padding: '4px 11px', borderRadius: 20, letterSpacing: '0.1em' }}>ZIGZAG</span>}
          {isPlannedFast && <span style={{ background: '#0e1e30', border: '1px solid #1a4a7a', color: C.blue, fontSize: 10, fontWeight: 700, padding: '4px 11px', borderRadius: 20, letterSpacing: '0.1em' }}>PLANNED FAST</span>}
        </div>
        <div style={{ display: 'grid', gap: 9 }}>
          {(coachOpen ? insights : insights.slice(0, 2)).map((ins, i) => (
            <div key={i} style={{ display:'flex', gap:11, alignItems:'flex-start', background:`${ins.color}14`, borderRadius:12, padding:'12px 13px' }}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:ins.color, flexShrink:0, marginTop:5 }} />
              <span style={{ fontSize:13, color:C.text, lineHeight:1.5 }}>{ins.msg}</span>
            </div>
          ))}
          {insights.length > 2 && (
            <button onClick={() => setCoachOpen(o => !o)} style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', color:C.textSub, fontSize:12, fontWeight:500, fontFamily:F.body, cursor:'pointer', padding:'2px 0', marginTop:2 }}>
              {coachOpen ? 'Show less' : `Show ${insights.length - 2} more insights`}
              <Icon name={coachOpen ? 'chevronLeft' : 'chevronRight'} size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Vitals */}
      <div style={card()}>
        <div style={{ fontFamily:F.head, fontWeight:700, fontSize:15, marginBottom:18 }}>Today's Vitals</div>
        <div style={{ display:'grid', gap:14 }}>
          {[{key:'weight',icon:'scale',label:'Weight',unit:'kg',step:'0.1',ph:'73.5'},{key:'sleep',icon:'moon',label:'Sleep',unit:'hrs',step:'0.5',ph:'7.5'},{key:'steps',icon:'steps',label:'Steps',unit:'',step:'100',ph:`${stepData.goal.toLocaleString()}`},
            ...(adaptiveTDEE.activeCut ? [{key:'inclineMin',icon:'compass',label:'Incline walk',unit:'min',step:'5',ph:`${adaptiveTDEE.cardioMin}`}] : [])].map(({key,icon,label,unit,step,ph}) => (
            <div key={key} style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{width:26,display:'inline-flex',justifyContent:'center'}}><Icon name={icon} size={18} color={C.textSub} /></span>
              <span style={{color:C.textSub,fontSize:13,flex:1}}>{label}</span>
              <input type="number" inputMode="decimal" step={step} value={local[key]??''} placeholder={ph} onChange={e=>upd(key,e.target.value?+e.target.value:null)} style={inp({width:mobile?90:100,textAlign:'right',fontFamily:F.mono,fontSize:15,padding:'8px 12px'})} />
              {unit && <span style={{fontSize:12,color:C.textSub,width:28}}>{unit}</span>}
            </div>
          ))}
        </div>

        {/* Active Cut — movement banked toward today's deficit */}
        {adaptiveTDEE.activeCut && (() => {
          const tgtMin = adaptiveTDEE.cardioMin
          const doneMin = local.inclineMin || 0
          const doneBurn = inclineWalkBurn(doneMin, adaptiveTDEE.curW)
          const tgtBurn  = adaptiveTDEE.cardioBurn
          const pct = tgtMin > 0 ? Math.min(doneMin / tgtMin * 100, 100) : 0
          return (
            <div style={{ marginTop:14, paddingTop:14, borderTop:`1px solid ${C.border}` }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <span style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,color:C.textSub}}><Icon name="compass" size={13} color={C.textSub} /> Incline walk · movement banked</span>
                <span style={{fontFamily:F.mono,fontSize:14,color:doneMin>=tgtMin?C.teal:C.purple}}>{doneBurn} / {tgtBurn} kcal</span>
              </div>
              <div style={{height:4,background:C.border,borderRadius:2}}><div style={{height:'100%',width:`${pct}%`,background:doneMin>=tgtMin?C.teal:C.purple,borderRadius:2,transition:'width 0.4s'}} /></div>
              <div style={{fontSize:11,color:C.textSub,marginTop:5,lineHeight:1.5}}>
                {doneMin>=tgtMin
                  ? `✓ Target hit — your walk is paying ${doneBurn} kcal of today's deficit so you can eat more.`
                  : `${doneMin}/${tgtMin} min. Your target eats already assume this walk — skip it and the deficit shrinks.`}
              </div>
            </div>
          )
        })()}
        {/* Step goal */}
        <div style={{ marginTop:14, paddingTop:14, borderTop:`1px solid ${C.border}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <span style={{fontSize:12,color:C.textSub}}>Step goal today</span>
            <span style={{fontFamily:F.mono,fontSize:14,color:stepData.extra>0?C.orange:C.accent}}>{stepData.goal.toLocaleString()} steps</span>
          </div>
          {stepData.extra > 0 && <div style={{fontSize:11,color:C.orange,background:'rgba(240,150,77,0.1)',borderRadius:8,padding:'7px 11px',borderLeft:`3px solid ${C.orange}`,marginBottom:6}}>{stepData.reason}</div>}
          {local.steps != null && <>
            <div style={{height:4,background:C.border,borderRadius:2}}><div style={{height:'100%',width:`${Math.min((local.steps/stepData.goal)*100,100)}%`,background:local.steps>=stepData.goal?C.accent:C.purple,borderRadius:2}} /></div>
            <div style={{fontSize:11,color:C.textSub,marginTop:4,textAlign:'right'}}>{local.steps.toLocaleString()} / {stepData.goal.toLocaleString()}</div>
          </>}
        </div>
        {local.sleep != null && (
          <div style={{ marginTop:14, paddingTop:14, borderTop:`1px solid ${C.border}` }}>
            <div style={{...LBL,marginBottom:8}}>Sleep Quality</div>
            <div style={{display:'flex',gap:8}}>{['Poor','OK','Good','Great'].map(q => <button key={q} style={{...btn(local.sleepQuality===q,true),flex:1,padding:'5px 0',fontSize:12}} onClick={()=>upd('sleepQuality',q)}>{q}</button>)}</div>
          </div>
        )}
      </div>

      {cardioPlan && (
        <div style={card({ borderLeft:`3px solid ${C.purple}` })}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, marginBottom:6 }}>
            <div style={{ fontFamily:F.head, fontWeight:700, fontSize:15 }}>Zone 2 tracker</div>
            <span style={{ fontFamily:F.mono, fontSize:12, color:C.purple }}>{zone2WeekCompleted}/{cardioPlan.sessionsPerWeek || 2} sessions</span>
          </div>
          <div style={{ fontSize:12, color:C.textSub, lineHeight:1.45, marginBottom:12 }}>
            Weekly prescription: {cardioPlan.sessions} · {cardioPlan.weeklyMin} min total. Log each completed session on the day you do it.
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <button style={btn(true, true)} onClick={() => addZone2Session(cardioPlan.minutesPerSession || 20)}>+ Log {cardioPlan.minutesPerSession || 20} min session</button>
            {zone2Sessions.length > 0 && <button style={btn(false, true)} onClick={removeZone2Session}>Undo today’s last session</button>}
            <span style={{ fontFamily:F.mono, fontSize:11, color:C.textSub, marginLeft:'auto' }}>{zone2WeekMinutes}/{cardioPlan.weeklyMin} min this week</span>
          </div>
          {zone2Sessions.length > 0 && <div style={{ fontSize:11, color:C.teal, marginTop:10 }}>Today logged: {zone2Sessions.join(' + ')} min</div>}
        </div>
      )}

      {/* Meals */}
      <div ref={mealsRef} style={{...card(),gridColumn:'1/-1'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{fontFamily:F.head,fontWeight:700,fontSize:15}}>Meals</div>
            {isFasting && <span style={{background:'#0e1e30',border:'1px solid #1a4a7a',color:C.blue,fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:20}}>{isPlannedFast&&!local.fasting?'PLANNED FAST':'FASTING'}</span>}
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {!isFasting && yesterdayLog?.meals?.length > 0 && <button style={btn(false,true)} onClick={copyYesterday} title="Copy all of yesterday's meals">⧉ Yesterday</button>}
            {!isFasting && <button style={btn(false,true)} onClick={() => { const previous = addDaysStr(viewDate, -1); setCopySourceDate(previous); setCalendarMonth(new Date(previous + 'T12:00:00')); setCopyDayOpen(o => !o) }} title="Copy all meals from another day">Copy day</button>}
            {!isFasting && <button style={btn(true,true)} onClick={()=>setAddOpen(o=>!o)}>+ Add Meal</button>}
            <button style={{...btn(isFasting,true),...(isFasting?{background:'#0e1e30',borderColor:C.blue,color:C.blue}:{}), display:'inline-flex', alignItems:'center', gap:6}} onClick={toggleFasting}>
              {isFasting ? (isPlannedFast&&!local.fasting ? '↩ Override Fast' : '↩ Undo Fast') : <><Icon name="ban" size={14} /> Fasting Day</>}
            </button>
          </div>
        </div>

        {!isFasting && copyDayOpen && (
          <div style={{...card({background:'rgba(255,255,255,0.02)',marginBottom:16})}}>
            <div style={{fontSize:12,color:C.textSub,marginBottom:10}}>Copy every meal from a specific logged day into {niceDate}. Existing meals will be kept.</div>
            <div style={{display:'flex',gap:14,alignItems:'flex-start',flexWrap:'wrap'}}>
              <div style={{width:'min(100%, 360px)'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                  <label style={LBL}>Source day</label>
                  <span style={{fontFamily:F.mono,fontSize:11,color:C.textSub}}>{fmtDate(copySourceDate)}</span>
                </div>
                <div style={{background:'rgba(10,10,12,0.72)',border:`1px solid ${C.borderSoft}`,borderRadius:12,padding:10,boxSizing:'border-box',width:'100%'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                    <button type="button" aria-label="Previous month" onClick={()=>setCalendarMonth(d=>new Date(d.getFullYear(),d.getMonth()-1,1,12))} style={{...btn(false,true),padding:'4px 9px'}}>‹</button>
                    <span style={{fontFamily:F.head,fontWeight:700,fontSize:13}}>{calendarMonth.toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</span>
                    <button type="button" aria-label="Next month" onClick={()=>setCalendarMonth(d=>new Date(d.getFullYear(),d.getMonth()+1,1,12))} style={{...btn(false,true),padding:'4px 9px'}}>›</button>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(7,minmax(0,1fr))',gap:4,marginBottom:4}}>
                    {DAY_NAMES.map(day=><div key={day} style={{textAlign:'center',fontSize:9,color:C.textFaint,fontFamily:F.mono}}>{day.slice(0,1)}</div>)}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(7,minmax(0,1fr))',gap:4}}>
                    {calendarCells.map(date => {
                      const d = new Date(date + 'T12:00:00')
                      const inMonth = d.getMonth() === calendarMonth.getMonth()
                      if (!inMonth) return <div key={date} aria-hidden="true" style={{minHeight:42}} />
                      const future = date > todayStr()
                      const sameDay = date === viewDate
                      const cals = calendarCalsFor(date)
                      const dayLog = calendarLogFor(date)
                      const hasMeals = !!dayLog?.meals?.length
                      const isFastingDay = !!dayLog?.fasting
                      const selected = date === copySourceDate
                      const calsColor = calendarCalsColor(date, cals, hasMeals)
                      return <button key={date} type="button" disabled={future || sameDay || !hasMeals}
                        onClick={()=>setCopySourceDate(date)}
                        title={isFastingDay ? `${fmtDate(date)} · Fasting day` : hasMeals ? `${fmtDate(date)} · ${cals} kcal` : 'No meals logged'}
                        style={{minHeight:42,width:'100%',boxSizing:'border-box',padding:'4px 2px',borderRadius:8,border:`1px solid ${selected?C.accent:'transparent'}`,background:selected?'rgba(167,139,250,0.16)':'transparent',color:inMonth?C.text:C.textFaint,opacity:future||sameDay||(!hasMeals&&!isFastingDay)?0.38:1,cursor:future||sameDay||!hasMeals?'default':'pointer',fontFamily:F.body,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
                        <div style={{fontSize:12,fontWeight:selected?700:500}}>{d.getDate()}</div>
                        <div style={{fontFamily:F.mono,fontSize:isFastingDay?15:8,lineHeight:1,color:isFastingDay?C.blue:calsColor,marginTop:2,whiteSpace:'nowrap'}}>{isFastingDay?'×':hasMeals?`${cals} kcal`:'—'}</div>
                      </button>
                    })}
                  </div>
                </div>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center',alignSelf:'flex-end',paddingBottom:10}}>
                <button style={{...btn(true,true),opacity:copySourceLog?.meals?.length && copySourceDate !== viewDate ? 1 : 0.45}} disabled={!copySourceLog?.meals?.length || copySourceDate === viewDate} onClick={copyMealsFromDay}>Copy meals</button>
                <button style={btn(false,true)} onClick={()=>setCopyDayOpen(false)}>Cancel</button>
              </div>
            </div>
            {copySourceDate === viewDate
              ? <div style={{fontSize:11,color:C.orange,marginTop:8}}>Choose a different day.</div>
              : !copySourceLog?.meals?.length && <div style={{fontSize:11,color:C.orange,marginTop:8}}>No meals are logged on that day.</div>}
          </div>
        )}

        {/* Add meal panel */}
        {addOpen && (
          <div style={{...card({background:'rgba(255,255,255,0.02)',marginBottom:16})}}>
            {mealHistory.length > 0 && (
              <div style={{marginBottom:16}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                  <div style={{fontSize:11,color:C.textSub,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',whiteSpace:'nowrap'}}>Quick Add</div>
                  <input style={inp({flex:1,padding:'6px 12px',fontSize:12})} placeholder="Search previous meals…" value={historySearch} onChange={e=>setHistorySearch(e.target.value)} />
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:8,maxHeight:130,overflowY:'auto'}}>
                  {mealHistory.filter(m=>!historySearch||m.name.toLowerCase().includes(historySearch.toLowerCase())).slice(0,historySearch?20:8).map((m,i) => (
                    <button key={i} onClick={()=>quickAdd(m)} style={{display:'flex',alignItems:'center',gap:8,background:'rgba(255,255,255,0.03)',border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 12px',cursor:'pointer',fontFamily:F.body,transition:'all 0.15s',textAlign:'left'}}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor=C.accent;e.currentTarget.style.background='rgba(167,139,250,0.08)'}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.background='#13151e'}}>
                      <div>
                        <div style={{fontSize:13,color:C.text,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.name}</div>
                        <div style={{fontSize:11,color:C.textSub,marginTop:2}}>
                          <span style={{color:C.accent}}>{m.cals} kcal</span>
                          <span style={{margin:'0 4px',color:C.border}}>·</span>
                          <span style={{color:C.orange}}>{m.protein}g P</span>
                          {m.count > 1 && <span style={{marginLeft:6,color:C.purple,fontSize:10}}>×{m.count}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <div style={{borderTop:`1px solid ${C.border}`,marginTop:12,paddingTop:12,fontSize:11,color:C.textSub}}>Or enter manually:</div>
              </div>
            )}
            <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:12}}>
              <button style={{...btn(true,true),flex:'0 0 auto',display:'inline-flex',alignItems:'center',gap:7}} onClick={()=>setFoodPickerOpen(true)}><Icon name="apple" size={14} /> From Food Database</button>
              <span style={{fontSize:11,color:C.textFaint}}>or enter manually below</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:mobile?'repeat(3,minmax(0,1fr))':'2fr 1fr 1fr 1fr 1fr 1fr',gap:10,marginBottom:12}}>
              {[{k:'name',label:'Food / Meal',ph:'Chicken breast 200g',type:'text'},{k:'cals',label:'Calories',ph:'330',type:'number'},{k:'protein',label:'Protein (g)',ph:'62',type:'number'},{k:'carbs',label:'Carbs (g)',ph:'0',type:'number'},{k:'fat',label:'Fat (g)',ph:'7',type:'number'},{k:'fiber',label:'Fibre (g)',ph:'0',type:'number'}].map(({k,label,ph,type}) => (
                <div key={k} style={mobile&&k==='name'?{gridColumn:'1/-1'}:undefined}><label style={LBL}>{label}</label><input style={inp()} type={type} inputMode={type==='number'?'decimal':undefined} value={mf[k]} placeholder={ph} onChange={e=>setMf(p=>({...p,[k]:e.target.value}))} /></div>
              ))}
            </div>
            <div style={{display:'flex',gap:10}}><button style={btn(true,true)} onClick={addMeal}>Add</button><button style={btn(false,true)} onClick={()=>{setAddOpen(false);setHistorySearch('')}}>Cancel</button></div>
          </div>
        )}

        {foodPickerOpen && (
          <FoodPicker
            customFoods={customFoods}
            recipes={recipes}
            onPick={(meal)=>{ const next={...local,meals:[...local.meals,meal]}; setLocal(next); onSave(next); onSaveMealHistory?.(meal); buzz(12); setFoodPickerOpen(false); setAddOpen(false) }}
            onAddCustom={onSaveCustomFood}
            onClose={()=>setFoodPickerOpen(false)}
          />
        )}

        {local.meals.length === 0 ? (
          <div style={{textAlign:'center',padding:'40px 0',color:C.textSub,fontSize:14}}>{isFasting?'Fasting — no meals today.':'No meals logged yet — add your first!'}</div>
        ) : (<>
          {/* Collapsible summary bar */}
          <button onClick={()=>setMealsExpanded(e=>!e)} style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', background:'rgba(255,255,255,0.02)', border:`1px solid ${C.borderSoft}`, borderRadius:12, padding:'12px 14px', cursor:'pointer', fontFamily:F.body, marginBottom: mealsExpanded ? 10 : 0 }}>
            <span style={{ display:'flex', alignItems:'center', gap:9 }}>
              <span style={{ fontSize:13, color:C.text, fontWeight:600 }}>{local.meals.length} {local.meals.length===1?'item':'items'}</span>
              <span style={{ fontSize:12, color:C.textSub, fontFamily:F.mono }}>{totalCals} kcal · {totalProtein}P / {totalCarbs}C / {totalFat}F</span>
            </span>
            <span style={{ color:C.textSub, fontSize:13, transition:'transform 0.2s', transform: mealsExpanded?'rotate(180deg)':'none' }}>▾</span>
          </button>

          {mealsExpanded && <>
          <div style={{display:'grid',gridTemplateColumns:mobile?'1.6fr 0.8fr 0.8fr 84px':'2fr 1fr 1fr 1fr 1fr 96px',gap:8,padding:'4px 10px',fontSize:10.5,color:C.textSub,textTransform:'uppercase',letterSpacing:'0.07em'}}>
            {(mobile?['Food','Cals','Prot','']:['Food','Calories','Protein','Carbs','Fat','']).map(h=><span key={h}>{h}</span>)}
          </div>
          {local.meals.map((m,i) => editIdx === i ? (
            editForm.smart ? (
              // Smart edit: change the AMOUNT, macros recompute from the food DB / recipe
              (() => {
                const recipe = m.recipeId ? recipeById[m.recipeId] : null
                const food   = !recipe ? foodById[m.foodId] : null
                const amt    = editForm.amount && +editForm.amount > 0 ? +editForm.amount : null
                const prev   = amt ? (recipe ? mealFromRecipe(recipe, amt) : computeFoodMacros(food, amt)) : null
                return (
                  <div key={i} style={{background:'rgba(255,255,255,0.02)',borderRadius:8,marginBottom:6,padding:'12px',border:`1px solid ${C.accent}33`}}>
                    <div style={{fontSize:13,fontWeight:600,marginBottom:9}}>{recipe ? recipe.name : food.name}</div>
                    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10,flexWrap:'wrap'}}>
                      <input style={inp({width:110,textAlign:'center',fontFamily:F.mono,fontSize:15,padding:'8px 10px'})} type="number" inputMode="decimal" autoFocus value={editForm.amount}
                        onChange={e=>setEditForm(p=>({...p,amount:e.target.value}))} onKeyDown={e=>e.key==='Enter'&&saveEdit()} />
                      <span style={{fontSize:12,color:C.textSub}}>{recipe ? 'servings' : UNIT_LABEL[food.unit]||food.unit}</span>
                      {prev && <span style={{fontFamily:F.mono,fontSize:12.5,color:C.accent,marginLeft:'auto'}}>{prev.cals} kcal · {prev.protein}P / {prev.carbs}C / {prev.fat}F</span>}
                    </div>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <button style={btn(true,true)} onClick={saveEdit}>Save</button>
                      <button style={btn(false,true)} onClick={()=>setEditIdx(null)}>Cancel</button>
                      <button style={{background:'none',border:'none',color:C.textSub,cursor:'pointer',fontSize:11,marginLeft:'auto',fontFamily:F.body}}
                        onClick={()=>setEditForm({smart:false,...m})}>edit values manually</button>
                    </div>
                  </div>
                )
              })()
            ) : (
            // Manual edit row
            <div key={i} style={{background:'rgba(255,255,255,0.02)',borderRadius:8,marginBottom:6,padding:'10px',border:`1px solid ${C.accent}33`}}>
              <div style={{display:'grid',gridTemplateColumns:mobile?'repeat(5,minmax(0,1fr))':'2fr 1fr 1fr 1fr 1fr 1fr',gap:8,marginBottom:8}}>
                {[{k:'name',ph:'Food',type:'text'},{k:'cals',ph:'Cal',type:'number'},{k:'protein',ph:'P(g)',type:'number'},{k:'carbs',ph:'C(g)',type:'number'},{k:'fat',ph:'F(g)',type:'number'},{k:'fiber',ph:'Fib(g)',type:'number'}].map(({k,ph,type}) => (
                  <input key={k} style={inp({padding:'7px 8px',fontSize:13,...(mobile&&k==='name'?{gridColumn:'1/-1'}:{})})} type={type} inputMode={type==='number'?'decimal':undefined} value={editForm[k]??''} placeholder={ph} onChange={e=>setEditForm(p=>({...p,[k]:e.target.value}))} />
                ))}
              </div>
              <div style={{display:'flex',gap:8}}><button style={btn(true,true)} onClick={saveEdit}>Save</button><button style={btn(false,true)} onClick={()=>setEditIdx(null)}>Cancel</button></div>
            </div>
            )
          ) : (
            <div key={i} style={{display:'grid',gridTemplateColumns:mobile?'1.6fr 0.8fr 0.8fr 84px':'2fr 1fr 1fr 1fr 1fr 96px',gap:8,padding:'12px 10px',background:'rgba(255,255,255,0.02)',borderRadius:8,marginBottom:6,alignItems:'center',fontSize:mobile?13:14}}>
              <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.name}</span>
              <span style={{fontFamily:F.mono,color:C.accent}}>{m.cals}</span>
              <span style={{fontFamily:F.mono,color:C.orange}}>{m.protein}g</span>
              {!mobile && <span style={{fontFamily:F.mono,color:C.blue}}>{m.carbs}g</span>}
              {!mobile && <span style={{fontFamily:F.mono,color:C.textSub}}>{m.fat}g</span>}
              <div style={{display:'flex',gap:2,justifyContent:'flex-end'}}>
                <button onClick={()=>dupMeal(i)} title="Log this again" style={{background:'none',border:'none',color:C.textSub,cursor:'pointer',fontSize:14,padding:'4px 5px',lineHeight:1}}
                  onMouseEnter={e=>e.currentTarget.style.color=C.teal} onMouseLeave={e=>e.currentTarget.style.color=C.textSub}>⧉</button>
                <button onClick={()=>startEdit(i)} style={{background:'none',border:'none',color:C.textSub,cursor:'pointer',fontSize:15,padding:'4px 5px',lineHeight:1}}
                  onMouseEnter={e=>e.currentTarget.style.color=C.accent} onMouseLeave={e=>e.currentTarget.style.color=C.textSub}>✎</button>
                <button onClick={()=>removeMeal(i)} style={{background:'none',border:'none',color:C.textSub,cursor:'pointer',fontSize:19,padding:'4px 5px',lineHeight:1}}
                  onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.textSub}>×</button>
              </div>
            </div>
          ))}
          </>}
          {!isFasting && (
            <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${C.border}`,display:'grid',gridTemplateColumns:mobile?'repeat(2,1fr)':'repeat(4,1fr)',gap:10}}>
              {[{label:'Protein',eaten:totalProtein,target:effectiveMacros.proteinG,color:C.protein},{label:'Carbs',eaten:totalCarbs,target:effectiveMacros.carbG,color:C.carbs},{label:'Fat',eaten:totalFat,target:effectiveMacros.fatG,color:C.fat},{label:'Fibre',eaten:totalFiber,target:effectiveMacros.fiberG||30,color:C.fiber}].map(({label,eaten,target,color}) => (
                <div key={label}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:5}}><span style={{color:C.textSub}}>{label}</span><span style={{fontFamily:F.mono,color}}>{eaten}<span style={{color:C.textSub}}>/{target}g</span></span></div>
                  <div style={{height:4,background:C.border,borderRadius:2}}><div style={{height:'100%',width:`${Math.min((eaten/target)*100,100)}%`,background:color,borderRadius:2}} /></div>
                </div>
              ))}
            </div>
          )}
        </>)}
      </div>

      {/* FAB — fastest path to logging a meal (mobile, today only) */}
      {mobile && isToday && !isFasting && !addOpen && !foodPickerOpen && (
        <button onClick={() => { setAddOpen(true); buzz(10); setTimeout(() => mealsRef.current?.scrollIntoView({ behavior:'smooth', block:'start' }), 60) }}
          style={{ position:'fixed', right:16, bottom:'calc(86px + env(safe-area-inset-bottom, 0px))', zIndex:90,
            width:56, height:56, borderRadius:'50%', border:'none', cursor:'pointer',
            background:`linear-gradient(135deg, ${C.accent}, ${C.accentDim})`, color:'#0a0612',
            fontSize:30, fontWeight:600, lineHeight:1, boxShadow:`0 6px 24px -4px ${C.accent}aa, 0 2px 8px #0008`,
            display:'flex', alignItems:'center', justifyContent:'center', animation:'fadeUp 0.25s ease' }}>+</button>
      )}

      {/* Undo toast */}
      {toast && (
        <div style={{ position:'fixed', left:'50%', transform:'translateX(-50%)',
          bottom: mobile ? 'calc(92px + env(safe-area-inset-bottom, 0px))' : 28, zIndex:300,
          background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:13, padding:'11px 16px',
          display:'flex', gap:14, alignItems:'center', boxShadow:SHADOW, maxWidth:'92vw', animation:'fadeUp 0.2s ease' }}>
          <span style={{ fontSize:12.5, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{toast.msg}</span>
          {toast.undo && <button onClick={toast.undo} style={{ background:'none', border:'none', color:C.accent, fontWeight:700, fontSize:12.5, cursor:'pointer', fontFamily:F.body, letterSpacing:'0.04em', flexShrink:0 }}>UNDO</button>}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   NUTRITION TAB
═══════════════════════════════════════════════════════════════ */
function NutritionTab({ log, dayPlan, adaptiveTDEE, allLogs, setup, planSettings = {}, zigzagSettings = {}, recipes = [], onSaveRecipes, customFoods = [] }) {
  const mobile = useIsMobile()
  const [builder, setBuilder] = useState(null)   // null | {recipe: r|null}
  const [profileMeal, setProfileMeal] = useState(null)
  const saveRecipe = r => {
    const next = recipes.some(x => x.id === r.id) ? recipes.map(x => x.id === r.id ? r : x) : [...recipes, r]
    onSaveRecipes?.(next)
  }
  const delRecipe = id => { if (!confirm('Delete this saved meal?')) return; onSaveRecipes?.(recipes.filter(r => r.id !== id)) }
  const sum = fn => Math.round((log.meals||[]).reduce((s,m)=>s+(fn(m)||0),0)*10)/10
  const todayCals=Math.round(sum(m=>+m.cals)),todayP=sum(m=>+m.protein),todayC=sum(m=>+m.carbs),todayF=sum(m=>+m.fat),todayFib=sum(m=>+m.fiber)
  const regime = dayPlan.regime
  const macros = { calTarget: dayPlan.eatTarget, proteinG: dayPlan.proteinG, carbG: dayPlan.carbG, fatG: dayPlan.fatG, fiberG: dayPlan.fiberG }
  const nutritionFoods = useMemo(() => {
    const map = Object.fromEntries(FOOD_DB.map(f => [f.id, f]))
    customFoods.forEach(f => { map[f.id] = f })
    return Object.values(map)
  }, [customFoods])
  const dayNutrition = useMemo(() => getDayMicronutrients(log, { foods:nutritionFoods, recipes, setup }), [log, nutritionFoods, recipes, setup])
  const nutrientCoach = useMemo(() => getNutritionCoach(dayNutrition, nutritionFoods, { remainingCalories:Math.max(0, macros.calTarget - todayCals), remainingFat:Math.max(0, macros.fatG - todayF) }), [dayNutrition, nutritionFoods, macros.calTarget, macros.fatG, todayCals, todayF])
  // real calendar windows; only days with intake signal (meals or a logged
  // fast) count toward averages — weight-only days would drag them to 0
  const cut7=addDaysStr(todayStr(),-6), cut14=addDaysStr(todayStr(),-13)
  const r7=allLogs.filter(l=>l.date>=cut7&&((l.meals&&l.meals.length)||l.fasting))
  const avg7=fn=>r7.length?Math.round(r7.reduce((s,l)=>s+fn(l),0)/r7.length):0
  const avgCals=avg7(l=>(l.meals||[]).reduce((s,m)=>s+(+m.cals||0),0))
  const avgProt=avg7(l=>(l.meals||[]).reduce((s,m)=>s+(+m.protein||0),0))
  const calHistory=allLogs.filter(l=>l.date>=cut14).map(l=>({date:fmtDate(l.date),cals:(l.meals||[]).reduce((s,m)=>s+(+m.cals||0),0)}))
  // 14-day adherence: % of intake-logged days at/under that day's target (+75 grace)
  const adherence=(()=>{
    const days=allLogs.filter(l=>l.date>=cut14&&((l.meals&&l.meals.length)||l.fasting))
    if(days.length<3)return null
    const targetFor=l=>l.planSnapshot?.eatTarget ?? getPlanForDate({ date:l.date, log:l, setup, logs:allLogs, planSettings, zigzagSettings }).eatTarget
    const hit=days.filter(l=>(l.meals||[]).reduce((s,m)=>s+(+m.cals||0),0)<=targetFor(l)+75).length
    return {pct:Math.round(hit/days.length*100),hit,total:days.length}
  })()
  return (
    <div style={{padding:mobile?12:20,maxWidth:980,margin:'0 auto',display:'grid',gap:mobile?10:16}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:12}}>
        {[{label:'Today · kcal',val:todayCals,unit:'',color:C.accent},{label:'Target · kcal',val:macros.calTarget,unit:'',color:C.text},{label:'7-day avg · kcal',val:avgCals,unit:'',color:C.blue},{label:'7-day protein',val:avgProt,unit:'g',color:C.protein}].map(({label,val,unit,color})=>(
          <div key={label} style={card({textAlign:'center'})}><div style={{fontFamily:F.mono,fontSize:26,fontWeight:700,color,lineHeight:1}}>{val}<span style={{fontSize:13}}>{unit}</span></div><div style={{fontSize:11,color:C.textSub,marginTop:7,textTransform:'uppercase',letterSpacing:'0.07em'}}>{label}</div></div>
        ))}
      </div>
      {adherence!=null && (()=>{const c=adherence.pct>=80?C.teal:adherence.pct>=60?C.gold:C.red;return(
        <div style={card({padding:'16px 18px'})}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:11}}>
            <span style={{...LBL,marginBottom:0}}>14-day adherence</span>
            <span style={{fontFamily:F.mono,fontSize:22,fontWeight:700,color:c}}>{adherence.pct}%</span>
          </div>
          <div style={{height:7,background:C.borderSoft,borderRadius:4,overflow:'hidden'}}><div style={{height:'100%',width:`${adherence.pct}%`,background:c,borderRadius:4}} /></div>
          <div style={{fontSize:12,color:C.textSub,marginTop:9,lineHeight:1.4}}>{adherence.hit} of {adherence.total} logged days at or under target.{adherence.pct>=80?' Strong consistency.':''}</div>
        </div>
      )})()}
      <div style={card({border:`1px solid ${C.teal}33`})}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:15}}>Micronutrients</div>
          <span style={{fontFamily:F.mono,fontSize:11,color:C.textSub}}>{dayNutrition.mealsWithData}/{dayNutrition.totalMeals} meals mapped</span>
        </div>
        <div style={{fontSize:12,color:C.textSub,lineHeight:1.45,marginBottom:14}}>Logged-food coverage only. This is an intake estimate, not a deficiency diagnosis.</div>
        <div style={{display:'grid',gridTemplateColumns:mobile?'1fr':'repeat(2,1fr)',gap:'10px 18px'}}>
          {dayNutrition.comparison.map(n=>{
            const color=n.status==='very_low'?C.red:n.status==='low'?C.orange:n.status==='high'?C.darkGreen:n.status==='adequate'?C.green:C.textSub
            return <div key={n.id}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11.5,marginBottom:5}}><span style={{color:C.textSub}}>{n.label}</span><span style={{fontFamily:F.mono,color}}>{n.consumed == null ? '—' : `${n.consumed} ${n.unit}`}<span style={{color:C.textFaint}}> / {n.target == null ? '—' : `${n.target} ${n.unit}`} · {n.percentage == null ? '—' : `${n.percentage}%`}</span></span></div>
              <div style={{height:5,background:C.borderSoft,borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(n.percentage||0,100)}%`,background:color,borderRadius:3}} /></div>
            </div>
          })}
        </div>
        {!dayNutrition.comparison.some(n=>n.status!=='unknown') && <div style={{fontSize:12,color:C.textSub}}>All nutrient values are currently unknown. Add a mapped food profile to start tracking them.</div>}
      </div>
      {nutrientCoach.length>0 && <div style={card({border:`1px solid ${C.orange}44`})}>
        <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:5}}>Improve today</div>
        <div style={{fontSize:12,color:C.textSub,lineHeight:1.45,marginBottom:12}}>These are food-log gaps. Choose an option that fits your remaining calories and macros.</div>
        <div style={{display:'grid',gap:8}}>{nutrientCoach.map(g=><details key={g.id} style={{background:'rgba(255,255,255,0.02)',borderRadius:11,overflow:'hidden'}}>
          <summary style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'11px 12px',fontSize:12.5,cursor:'pointer',listStylePosition:'inside'}}><strong style={{color:C.orange}}>{g.label}</strong><span style={{fontFamily:F.mono,color:C.textSub}}>{g.percentage}% of target</span></summary>
          <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>{g.suggestions.slice(0,3).map(s=><span key={s.food.id} style={{fontSize:11,color:C.textSub,border:`1px solid ${C.borderSoft}`,borderRadius:8,padding:'5px 8px'}}>{s.food.name} · {s.serving}{s.food.unit} / +{s.nutrition.micros[g.id].toFixed(1)} {g.unit}</span>)}</div>
        </details>)}</div>
      </div>}
      <div style={card()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:15}}>Food micronutrient profiles</div>
          <span style={{fontFamily:F.mono,fontSize:11,color:C.textSub}}>{dayNutrition.mealsWithData} mapped</span>
        </div>
        <div style={{fontSize:12,color:C.textSub,lineHeight:1.45,marginBottom:12}}>Complete tracked-food profiles, scaled to the quantity you logged today.</div>
        {dayNutrition.meals.length ? <div style={{display:'grid',gap:8}}>{dayNutrition.meals.map((meal,i)=>{
          const open = profileMeal === i
          return <div key={`${meal.name}-${i}`} style={{border:`1px solid ${open?C.accent:C.borderSoft}`,borderRadius:11,overflow:'hidden'}}>
            <button onClick={()=>setProfileMeal(open?null:i)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,width:'100%',padding:'11px 12px',background:'rgba(255,255,255,0.02)',border:'none',color:C.text,fontFamily:F.body,cursor:'pointer',textAlign:'left'}}>
              <span style={{fontSize:12.5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{meal.name}</span>
              <span style={{fontFamily:F.mono,fontSize:11,color:meal.micros?C.teal:C.textFaint,flexShrink:0}}>{meal.micros?'View profile':'Not mapped'} {open?'−':'+'}</span>
            </button>
            {open && <div style={{padding:'10px 12px',borderTop:`1px solid ${C.borderSoft}`}}>
              {meal.micros ? <div style={{display:'grid',gridTemplateColumns:mobile?'1fr 1fr':'repeat(3,1fr)',gap:6}}>{NUTRIENTS.map(n=><div key={n.id} style={{display:'flex',justifyContent:'space-between',gap:6,background:'rgba(255,255,255,0.02)',borderRadius:7,padding:'6px 7px',fontSize:10.5}}><span style={{color:C.textSub}}>{n.label}</span><span style={{fontFamily:F.mono,color:C.text}}>{meal.micros[n.id] != null ? `${meal.micros[n.id]} ${n.unit}` : '—'}</span></div>)}</div> : <div style={{fontSize:12,color:C.textSub}}>This was entered manually or uses a food without a micronutrient profile. Edit it using the food database to track its full profile.</div>}
            </div>}
          </div>
        })}</div> : <div style={{fontSize:12,color:C.textSub}}>No foods tracked today.</div>}
      </div>
      <div style={{display:'grid',gridTemplateColumns:mobile?'1fr':'1fr 2fr',gap:16}}>
        <div style={card()}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:18}}>Today's Macros</div>
          {[{name:'Protein',g:todayP,target:macros.proteinG,color:C.protein},{name:'Carbs',g:todayC,target:macros.carbG,color:C.carbs},{name:'Fat',g:todayF,target:macros.fatG,color:C.fat},{name:'Fibre',g:todayFib,target:macros.fiberG||30,color:C.fiber}].map(m=>(
            <div key={m.name} style={{marginBottom:18}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:7,fontSize:13}}><span style={{color:C.textSub}}>{m.name}</span><span style={{fontFamily:F.mono,color:m.color}}>{m.g}g <span style={{color:C.textSub,fontSize:11}}>/ {m.target}g</span></span></div>
              <div style={{height:4,background:C.border,borderRadius:2}}><div style={{height:'100%',width:`${Math.min((m.g/m.target)*100,100)}%`,background:m.color,borderRadius:2}} /></div>
            </div>
          ))}
        </div>
        <div style={card()}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:18}}>14-Day Calorie History</div>
          {calHistory.length>1?(
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={calHistory} margin={{top:5,right:5,bottom:5,left:-20}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                <XAxis dataKey="date" tick={{fill:C.textSub,fontSize:10}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fill:C.textSub,fontSize:10}} tickLine={false} axisLine={false}/>
                <Tooltip {...TT}/><ReferenceLine y={macros.calTarget} stroke={C.accent} strokeDasharray="4 4"/>
                <Bar dataKey="cals" fill={C.accent} opacity={0.85} radius={[3,3,0,0]} name="Calories"/>
              </BarChart>
            </ResponsiveContainer>
          ):<div style={{padding:'60px 0',textAlign:'center',color:C.textSub}}>Log meals for a few days to see history</div>}
        </div>
      </div>

      {/* ── Saved meals / recipe manager ── */}
      <div style={card()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
          <div style={{display:'inline-flex',alignItems:'center',gap:8,fontFamily:F.head,fontWeight:700,fontSize:15}}><Icon name="apple" size={17} color={C.accent} /> My Meals</div>
          <button style={btn(true,true)} onClick={()=>setBuilder({recipe:null})}>+ Build a Meal</button>
        </div>
        <div style={{fontSize:12,color:C.textSub,marginBottom:recipes.length?14:0,lineHeight:1.5}}>
          Pre-build the dishes you eat often. They show up under <strong style={{color:C.accent}}>My Meals</strong> in the food picker — one tap to log, editable by servings.
        </div>
        {recipes.length>0&&(
          <div style={{display:'grid',gap:8}}>
            {recipes.map(r=>(
              <div key={r.id} style={{display:'flex',alignItems:'center',gap:8,background:'rgba(255,255,255,0.02)',border:`1px solid ${C.borderSoft}`,borderRadius:11,padding:'10px 13px'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13.5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.name}</div>
                  <div style={{fontSize:11,color:C.textSub,marginTop:2}}><span style={{color:C.accent,fontFamily:F.mono}}>{r.perServing.cals} kcal</span> · {r.perServing.protein}g P / serving · {r.items.length} ingredient{r.items.length!==1?'s':''}</div>
                </div>
                <button onClick={()=>setBuilder({recipe:r})} style={{background:'none',border:'none',color:C.textSub,cursor:'pointer',fontSize:14,padding:'3px 5px'}}
                  onMouseEnter={e=>e.currentTarget.style.color=C.accent} onMouseLeave={e=>e.currentTarget.style.color=C.textSub}>✎</button>
                <button onClick={()=>delRecipe(r.id)} style={{background:'none',border:'none',color:C.textSub,cursor:'pointer',fontSize:17,padding:'3px 5px'}}
                  onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.textSub}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {builder && <RecipeBuilder recipe={builder.recipe} customFoods={customFoods} onSave={saveRecipe} onClose={()=>setBuilder(null)}/>}

      {regime==='zigzag' && (
        <div style={card()}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:16}}>This Week's Zigzag Targets</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,minmax(0,1fr))',gap:mobile?3:8}}>
            {dayPlan.week.map((d,i)=>(
              <div key={i} style={{textAlign:'center',background:d.isToday?'rgba(167,139,250,0.12)':'rgba(255,255,255,0.02)',border:`1px solid ${d.isToday?C.accent:C.borderSoft}`,borderRadius:10,padding:mobile?'8px 1px':'10px 6px',minWidth:0,overflow:'hidden'}}>
                <div style={{fontSize:mobile?9.5:11,color:d.isToday?C.accent:C.textSub,fontWeight:d.isToday?700:400,marginBottom:mobile?4:6}}>{d.name}</div>
                <div style={{fontFamily:F.mono,fontSize:mobile?11:14,color:d.isFast?C.blue:d.isToday?C.accent:C.text}}>{d.isFast?'Fast':d.eat}</div>
                {!mobile&&<div style={{fontSize:10,color:C.textSub,marginTop:3}}>{d.isFast?'':'kcal'}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   WEEKLY REVIEW — auto digest of the last 7 full days
═══════════════════════════════════════════════════════════════ */
function WeeklyReview({ logs, dayPlan, adaptiveTDEE, setup, planSettings = {}, zigzagSettings = {} }) {
  // Keep the review static throughout the week: Sunday–Saturday, finalized
  // when the next Sunday begins. Previously this used yesterday as the end,
  // which made the seven-day window roll forward every day.
  const latestEnd = addDaysStr(startOfWeekStr(), -1)
  const firstLogDate = logs.length ? logs.reduce((first, log) => log.date < first ? log.date : first, logs[0].date) : latestEnd
  // A review is available for every completed Sunday–Saturday window. Skip
  // sparse windows so cycling never lands on an empty/meaningless review.
  const reviewEnds = []
  for (let end = latestEnd; end >= firstLogDate; end = addDaysStr(end, -7)) {
    const start = addDaysStr(end, -6)
    const intakeCount = logs.filter(l => l.date >= start && l.date <= end && ((l.meals && l.meals.length) || l.fasting)).length
    if (intakeCount >= 4) reviewEnds.push(end)
  }
  const [reviewIndex, setReviewIndex] = useState(0)
  useEffect(() => setReviewIndex(index => Math.min(index, Math.max(0, reviewEnds.length - 1))), [reviewEnds.length])
  if (!reviewEnds.length) return null   // not enough data for a fair review

  const end   = reviewEnds[reviewIndex]
  const start = addDaysStr(end, -6)
  const week  = logs.filter(l => l.date >= start && l.date <= end)
  const intakeDays = week.filter(l => (l.meals && l.meals.length) || l.fasting)

  const trend = trendWeight(logs)
  const tAt = d => { let last = null; for (const t of trend) { if (t.date <= d) last = t; else break } return last }
  const tEnd = tAt(end), tStart = tAt(addDaysStr(start, -1)) || tAt(start)
  const deltaKg = tEnd && tStart && tEnd.date !== tStart.date ? Math.round((tEnd.trend - tStart.trend) * 100) / 100 : null

  const dayCals = l => (l.meals || []).reduce((s, m) => s + (+m.cals || 0), 0)
  const targetFor = l => l.planSnapshot?.eatTarget ?? getPlanForDate({ date:l.date, log:l, setup, logs, planSettings, zigzagSettings }).eatTarget
  const onTarget   = intakeDays.filter(l => dayCals(l) <= targetFor(l) + 75).length
  const avgIntake  = Math.round(intakeDays.reduce((s, l) => s + dayCals(l), 0) / intakeDays.length)
  const protDays   = intakeDays.filter(l => l.meals && l.meals.length)
  const avgProtein = protDays.length ? Math.round(protDays.reduce((s, l) => s + l.meals.reduce((x, m) => x + (+m.protein || 0), 0), 0) / protDays.length) : 0
  const steps = week.filter(l => l.steps).map(l => l.steps)
  const avgSteps = steps.length ? Math.round(steps.reduce((s, x) => s + x) / steps.length) : null
  const sleeps = week.filter(l => l.sleep).map(l => l.sleep)
  const avgSleep = sleeps.length ? Math.round(sleeps.reduce((s, x) => s + x) / sleeps.length * 10) / 10 : null

  const lost = deltaKg != null ? -deltaKg : null
  const curW = adaptiveTDEE.curW
  const healthyFloor = curW * ENGINE_CONST.IDEAL_RATE * 0.6
  const safeCeil     = curW * ENGINE_CONST.SAFE_RATE * 1.1
  let verdict, vColor
  if (adaptiveTDEE.phase === 'maintenance') { verdict = `Maintenance phase — the goal is a flat trend now${lost != null ? ` (moved ${deltaKg > 0 ? '+' : ''}${deltaKg}kg)` : ''}.`; vColor = C.teal }
  else if (lost == null)            { verdict = 'Weigh in more consistently to get a weekly verdict.'; vColor = C.textSub }
  else if (lost < -0.1)             { verdict = `Trend went UP ${Math.abs(lost).toFixed(2)}kg this week — check Cut IQ.`; vColor = C.red }
  else if (lost < healthyFloor)     { verdict = `Down ${lost.toFixed(2)}kg — slower than the healthy band. Cut IQ has the next lever.`; vColor = C.gold }
  else if (lost <= safeCeil)        { verdict = `Down ${lost.toFixed(2)}kg — right in the muscle-sparing band. Keep going.`; vColor = C.teal }
  else                              { verdict = `Down ${lost.toFixed(2)}kg — faster than safe. Consider easing the deficit.`; vColor = C.orange }

  return (
    <div style={card({ borderLeft: `3px solid ${vColor}` })}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:6, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap' }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:8, fontFamily:F.head, fontWeight:700, fontSize:15 }}><Icon name="flag" size={16} color={vColor} /> Weekly Review</div>
          <span style={{ fontSize:11, color:C.textSub, fontFamily:F.mono }}>{fmtDate(start)} – {fmtDate(end)}</span>
        </div>
        {reviewEnds.length > 1 && <div style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
          <button aria-label="Previous weekly review" title="Previous weekly review" disabled={reviewIndex >= reviewEnds.length - 1}
            style={{ ...btn(false, true), padding:'5px 7px', opacity:reviewIndex >= reviewEnds.length - 1 ? 0.35 : 1 }}
            onClick={() => { setReviewIndex(index => Math.min(index + 1, reviewEnds.length - 1)); buzz(8) }}>
            <Icon name="chevronLeft" size={15} />
          </button>
          <span style={{ fontSize:10, color:C.textSub, fontFamily:F.mono }}>{reviewIndex + 1}/{reviewEnds.length}</span>
          <button aria-label="Next weekly review" title="Next weekly review" disabled={reviewIndex <= 0}
            style={{ ...btn(false, true), padding:'5px 7px', opacity:reviewIndex <= 0 ? 0.35 : 1 }}
            onClick={() => { setReviewIndex(index => Math.max(index - 1, 0)); buzz(8) }}>
            <Icon name="chevronRight" size={15} />
          </button>
        </div>}
      </div>
      <div style={{ fontSize:13, color:vColor, fontWeight:600, marginBottom:14, lineHeight:1.45 }}>{verdict}</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
        {[
          { label:'Trend change', val: deltaKg != null ? `${deltaKg > 0 ? '+' : ''}${deltaKg} kg` : '—', color: deltaKg != null && deltaKg < 0 ? C.teal : C.orange },
          { label:'Days on target', val:`${onTarget}/${intakeDays.length}`, color: onTarget >= intakeDays.length - 1 ? C.teal : C.gold },
          { label:'Avg intake', val:`${avgIntake}`, unit:'kcal', color:C.accent },
          { label:'Avg protein', val:`${avgProtein}`, unit:'g', color:C.orange },
          { label:'Avg steps', val: avgSteps ? avgSteps.toLocaleString() : '—', color:C.purple },
          { label:'Avg sleep', val: avgSleep ?? '—', unit: avgSleep ? 'h' : '', color:C.blue },
        ].map(s => (
          <div key={s.label} style={{ textAlign:'center', background:'rgba(255,255,255,0.02)', borderRadius:11, padding:'11px 6px', border:`1px solid ${C.borderSoft}` }}>
            <div style={{ fontFamily:F.mono, fontSize:16, fontWeight:700, color:s.color }}>{s.val}{s.unit ? <span style={{ fontSize:10, color:C.textSub }}> {s.unit}</span> : null}</div>
            <div style={{ fontSize:10, color:C.textSub, marginTop:4 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   PROGRESS PHOTOS — private per-user bucket, compare first ↔ latest
═══════════════════════════════════════════════════════════════ */
async function resizeImage(file, maxDim = 1280) {
  try {
    const img = await createImageBitmap(file)
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    if (scale === 1 && file.type === 'image/jpeg') return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82))
  } catch { return file }   // browser can't decode → upload as-is
}

function ProgressPhotos() {
  const mobile = useIsMobile()
  const [photos, setPhotos] = useState(null)   // [{path, date, url}]
  const [viewer, setViewer] = useState(null)   // {url, date}
  const [busy,   setBusy]   = useState(false)
  const fileRef = useRef(null)

  useEffect(() => { (async () => {
    const paths = await store.listPhotos()
    const items = (await Promise.all(paths.map(async p => {
      const url = await store.photoUrl(p)
      return url ? { path: p, date: p.split('/')[1]?.slice(0, 10), url } : null
    }))).filter(Boolean)
    setPhotos(items)
  })() }, [])

  const addPhoto = async file => {
    if (!file) return
    setBusy(true)
    const blob = await resizeImage(file)
    const path = await store.uploadPhoto(blob, todayStr())
    if (path) {
      const url = await store.photoUrl(path)
      setPhotos(p => [...(p || []), { path, date: todayStr(), url }])
    } else {
      alert('Upload failed — make sure the progress-photos bucket exists (re-run supabase_schema.sql).')
    }
    setBusy(false)
  }
  const removePhoto = async p => {
    if (!confirm('Delete this photo?')) return
    if (await store.deletePhoto(p.path)) setPhotos(prev => prev.filter(x => x.path !== p.path))
  }

  const daysSinceLast = photos?.length ? daysBetween(photos[photos.length - 1].date, todayStr()) : null
  const first = photos?.[0], latest = photos?.length > 1 ? photos[photos.length - 1] : null

  return (
    <div style={card()}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
        <div style={{ display:'inline-flex', alignItems:'center', gap:8, fontFamily:F.head, fontWeight:700, fontSize:15 }}><Icon name="camera" size={17} color={C.accent} /> Progress Photos</div>
        <button style={btn(true, true)} disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Uploading…' : '+ Add Photo'}</button>
        {/* no `capture` attr — Android then offers BOTH camera and gallery */}
        <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }}
          onChange={e => { addPhoto(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      <div style={{ fontSize:12, color:C.textSub, marginBottom:14, lineHeight:1.5 }}>
        Scales lie week to week — photos don't. Same spot, same light, same pose.
        {daysSinceLast != null && daysSinceLast >= 7 && <strong style={{ color:C.orange }}> Last photo was {daysSinceLast} days ago — take one today.</strong>}
      </div>

      {photos === null ? (
        <div style={{ textAlign:'center', padding:'24px 0', color:C.textSub, fontSize:13 }}>Loading photos…</div>
      ) : photos.length === 0 ? (
        <div style={{ textAlign:'center', padding:'24px 0', color:C.textSub, fontSize:13 }}>No photos yet — take your day-1 photo now. You'll thank yourself at week 6.</div>
      ) : (
        <>
          {first && latest && (
            <div style={{ marginBottom:14 }}>
              <div style={{ ...LBL, marginBottom:8 }}>First ↔ Latest</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {[first, latest].map((p, i) => (
                  <div key={p.path} style={{ position:'relative' }}>
                    <img src={p.url} alt={p.date} onClick={() => setViewer(p)}
                      style={{ width:'100%', aspectRatio:'3/4', objectFit:'cover', borderRadius:12, border:`1px solid ${C.border}`, cursor:'pointer' }} />
                    <span style={{ position:'absolute', bottom:6, left:6, background:'#000a', borderRadius:7, padding:'2px 8px', fontSize:10, fontFamily:F.mono, color:C.text }}>{i === 0 ? 'Day 1 · ' : ''}{fmtDate(p.date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ display:'grid', gridTemplateColumns: mobile ? 'repeat(3,1fr)' : 'repeat(5,1fr)', gap:8 }}>
            {photos.map(p => (
              <div key={p.path} style={{ position:'relative' }}>
                <img src={p.url} alt={p.date} onClick={() => setViewer(p)}
                  style={{ width:'100%', aspectRatio:'3/4', objectFit:'cover', borderRadius:10, border:`1px solid ${C.borderSoft}`, cursor:'pointer' }} />
                <span style={{ position:'absolute', bottom:4, left:4, background:'#000a', borderRadius:6, padding:'1px 6px', fontSize:9, fontFamily:F.mono, color:C.textSub }}>{fmtDate(p.date)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {viewer && (
        <div style={{ position:'fixed', inset:0, background:'#000d', zIndex:700, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={() => setViewer(null)}>
          <img src={viewer.url} alt={viewer.date} style={{ maxWidth:'100%', maxHeight:'82vh', borderRadius:14, objectFit:'contain' }} onClick={e => e.stopPropagation()} />
          <div style={{ display:'flex', gap:12, marginTop:14, alignItems:'center' }}>
            <span style={{ fontFamily:F.mono, fontSize:13, color:C.text }}>{fmtDate(viewer.date)}</span>
            <button style={{ ...btn(false, true), color:C.red }} onClick={e => { e.stopPropagation(); removePhoto(viewer); setViewer(null) }}>Delete</button>
            <button style={btn(true, true)} onClick={() => setViewer(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   PROGRESS TAB
═══════════════════════════════════════════════════════════════ */
function ProgressTab({ logs, setup, currentBF, goalWeight, dayPlan, adaptiveTDEE, planSettings = {}, zigzagSettings = {}, onSaveLog }) {
  const mobile = useIsMobile()
  const sundayDate = (() => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate() - d.getDay()); return localDateStr(d) })()
  const latestSunday = [...logs].filter(l => l.measurements && isSunday(l.date)).at(-1)
  const sundayLog = logs.find(l => l.date === sundayDate) || latestSunday
  const [measurementForm, setMeasurementForm] = useState(() => normalizeMeasurements(sundayLog?.measurements || {}))
  useEffect(() => setMeasurementForm(normalizeMeasurements(sundayLog?.measurements || {})), [sundayLog?.date, sundayLog?.measurements])
  const latestWeight=logs.filter(l=>l.weight!=null).at(-1)?.weight??setup.startWeight
  // modeled BF from the Cut IQ engine (same number the Cut IQ tab shows)
  const latestBF=currentBF??setup.startBF
  const weightLost=setup.startWeight-latestWeight
  const r7=logs.filter(l=>l.date>=addDaysStr(todayStr(),-6))
  const avgOf=fn=>{const v=r7.filter(fn).map(fn);return v.length?Math.round(v.reduce((s,x)=>s+x)/v.length*10)/10:null}
  const avgSleep=avgOf(l=>l.sleep)
  const avgSteps=(()=>{const v=r7.filter(l=>l.steps).map(l=>l.steps);return v.length?Math.round(v.reduce((s,x)=>s+x)/v.length):null})()
  const weightData=logs.filter(l=>l.weight!=null).map(l=>({date:fmtDate(l.date),weight:l.weight,goal:+goalWeight.toFixed(1)}))
  const sleepData=logs.filter(l=>l.sleep!=null).map(l=>({date:fmtDate(l.date),sleep:l.sleep}))
  const stepsData=logs.filter(l=>l.steps!=null).map(l=>({date:fmtDate(l.date),steps:l.steps}))
  const measuredBF = estimateRFM({ heightCm: setup.height, waistIn: measurementForm.waistIn, sex: setup.sex })
  const updateMeasurement = (key, value) => {
    const nextMeasurements = { ...measurementForm, [key]: value === '' ? null : +value }
    setMeasurementForm(nextMeasurements)
    const base = sundayLog || { date:sundayDate, weight:null, sleep:null, sleepQuality:null, steps:null, inclineMin:null, meals:[], notes:'', fasting:false, fastingOverridden:false }
    onSaveLog?.({ ...base, date:sundayDate, measurements:nextMeasurements })
  }
  return (
    <div style={{padding:mobile?12:20,maxWidth:980,margin:'0 auto',display:'grid',gap:mobile?10:16}}>
      <WeeklyReview logs={logs} dayPlan={dayPlan} adaptiveTDEE={adaptiveTDEE} setup={setup} planSettings={planSettings} zigzagSettings={zigzagSettings}/>
      <div style={{display:'grid',gridTemplateColumns:mobile?'repeat(2,1fr)':'repeat(4,1fr)',gap:12}}>
        {[{label:'Weight Lost',val:weightLost>=0?`-${weightLost.toFixed(1)}`:`+${Math.abs(weightLost).toFixed(1)}`,unit:'kg',color:weightLost>=0?C.accent:C.red},{label:'Current BF %',val:`${latestBF}`,unit:'%',color:C.orange},{label:'7d Avg Sleep',val:avgSleep??'—',unit:avgSleep?'hrs':'',color:C.blue},{label:'7d Avg Steps',val:avgSteps?avgSteps.toLocaleString():'—',unit:'',color:C.purple}].map(({label,val,unit,color})=>(
          <div key={label} style={card({textAlign:'center'})}><div style={{fontFamily:F.mono,fontSize:28,fontWeight:700,color,lineHeight:1}}>{val}<span style={{fontSize:13}}> {unit}</span></div><div style={{fontSize:11,color:C.textSub,marginTop:6,textTransform:'uppercase',letterSpacing:'0.07em'}}>{label}</div></div>
        ))}
      </div>
      <div style={card()}>
        <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:16}}>Weight Trend</div>
        {weightData.length>0?(
          <ResponsiveContainer width="100%" height={240}>
            {/* ComposedChart: AreaChart silently drops <Line> children, so the goal line never rendered */}
            <ComposedChart data={weightData} margin={{top:5,right:10,bottom:5,left:-20}}>
              <defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="10%" stopColor={C.accent} stopOpacity={0.2}/><stop offset="95%" stopColor={C.accent} stopOpacity={0}/></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
              <XAxis dataKey="date" tick={{fill:C.textSub,fontSize:11}} tickLine={false} axisLine={false}/>
              <YAxis domain={['auto','auto']} tick={{fill:C.textSub,fontSize:11}} tickLine={false} axisLine={false}/>
              <Tooltip {...TT}/>
              <Area type="monotone" dataKey="weight" stroke={C.accent} fill="url(#wg)" strokeWidth={2.5} dot={{fill:C.accent,r:3,strokeWidth:0}} name="Weight (kg)"/>
              <Line type="monotone" dataKey="goal" stroke={C.red} strokeDasharray="5 5" strokeWidth={1.5} dot={false} name="Goal"/>
            </ComposedChart>
          </ResponsiveContainer>
        ):<div style={{padding:'70px 0',textAlign:'center',color:C.textSub}}>Log your weight each day in the Today tab</div>}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:mobile?10:16}}>
        <div style={card()}>
          <div style={{fontSize:12,color:C.textSub,fontWeight:600,marginBottom:10}}>Sleep</div>
          {sleepData.length>1?(
            <ResponsiveContainer width="100%" height={92}>
              <AreaChart data={sleepData} margin={{top:4,right:2,bottom:0,left:2}}>
                <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.blue} stopOpacity={0.3}/><stop offset="100%" stopColor={C.blue} stopOpacity={0}/></linearGradient></defs>
                <XAxis dataKey="date" hide/><YAxis domain={[4,10]} hide/>
                <Tooltip {...TT}/>
                <Area type="monotone" dataKey="sleep" stroke={C.blue} fill="url(#sg)" strokeWidth={2} dot={false} name="Sleep (hrs)"/>
              </AreaChart>
            </ResponsiveContainer>
          ):<div style={{padding:'30px 0',textAlign:'center',color:C.textSub,fontSize:12}}>Log sleep</div>}
        </div>
        <div style={card()}>
          <div style={{fontSize:12,color:C.textSub,fontWeight:600,marginBottom:10}}>Steps</div>
          {stepsData.length>1?(
            <ResponsiveContainer width="100%" height={92}>
              <BarChart data={stepsData} margin={{top:4,right:2,bottom:0,left:2}}>
                <XAxis dataKey="date" hide/><YAxis hide/>
                <Tooltip {...TT}/>
                <Bar dataKey="steps" fill={C.teal} opacity={0.85} radius={[2,2,0,0]} name="Steps"/>
              </BarChart>
            </ResponsiveContainer>
          ):<div style={{padding:'30px 0',textAlign:'center',color:C.textSub,fontSize:12}}>Log steps</div>}
        </div>
      </div>
      <div style={card({ borderLeft:`3px solid ${C.orange}` })}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,marginBottom:8}}>
          <div><div style={{fontFamily:F.head,fontWeight:700,fontSize:15}}>Sunday body measurements</div><div style={{fontSize:11.5,color:C.textSub,marginTop:5,lineHeight:1.45}}>Measure relaxed, at the same time every Sunday. Units: inches.</div></div>
          <span style={{fontFamily:F.mono,fontSize:11,color:C.textFaint,whiteSpace:'nowrap'}}>{fmtDate(sundayDate)}</span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:mobile?'1fr 1fr':'repeat(3,1fr)',gap:10,marginTop:12}}>
          {BODY_MEASUREMENTS.filter(m => !m.femaleOnly || setup.sex === 'female').map(m => <label key={m.key} style={{fontSize:11,color:C.textSub}}>{m.label}<span style={{display:'block',fontSize:9.5,color:C.textFaint,margin:'2px 0 5px'}}>{m.hint}</span><input type="number" inputMode="decimal" step="0.1" min="1" value={measurementForm[m.key] ?? ''} onChange={e=>updateMeasurement(m.key,e.target.value)} placeholder="—" style={inp({padding:'8px 9px',fontFamily:F.mono})} /></label>)}
        </div>
        <div style={{marginTop:14,paddingTop:13,borderTop:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <div><div style={LBL}>Estimated body fat · RFM</div><div style={{fontSize:11,color:C.textFaint}}>Uses height, waist and sex; not a diagnosis.</div></div>
          <div style={{fontFamily:F.mono,fontSize:24,fontWeight:700,color:measuredBF==null?C.textFaint:C.orange}}>{measuredBF == null ? '—' : `${measuredBF}%`}</div>
        </div>
        <div style={{fontSize:10.5,color:C.textFaint,marginTop:10,lineHeight:1.45}}>Arms, forearms, chest and neck are saved for weekly trend tracking. RFM does not claim they improve accuracy without a validated population-specific model.</div>
      </div>
      <ProgressPhotos/>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   SCHEDULE TAB — Calorie strategy + fasting manager
═══════════════════════════════════════════════════════════════ */
function PlanTab({ dayPlan, planSettings, onSavePlanSettings, adaptiveTDEE, setup, zigzagSettings, onSaveZigzag }) {
  const mobile = useIsMobile()

  const [zigzagSched, setZigzagSched] = useState(zigzagSettings?.schedule || 1)
  const [zigzagMode,  setZigzagMode]  = useState(zigzagSettings?.mode || 'weight')
  const [zigzagOn,    setZigzagOn]    = useState(zigzagSettings?.on || false)
  const fastingDays = Array.isArray(planSettings?.fastingDays) ? planSettings.fastingDays : []
  const toggleFastingDay = dow => {
    const next = fastingDays.includes(dow)
      ? fastingDays.filter(day => day !== dow)
      : [...fastingDays, dow].sort((a, b) => a - b)
    onSavePlanSettings?.({ ...planSettings, fastingDays: next })
  }

  // today's target comes straight from the single source of truth
  const isFastingToday = dayPlan.fasting.isFasting
  const todayTarget    = dayPlan.eatTarget

  return (
    <div style={{padding:mobile?12:20,maxWidth:980,margin:'0 auto',display:'grid',gap:mobile?10:16}}>

      {/* Calorie Strategy */}
      <div style={card()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:16}}>Calorie Strategy</div>
          <div style={{display:'flex',gap:6}}>
            {adaptiveTDEE.isDataDriven && <span style={{fontSize:10,color:C.accent,background:'rgba(167,139,250,0.12)',border:`1px solid ${C.accent}44`,padding:'3px 10px',borderRadius:20,fontWeight:700}}>DATA-DRIVEN</span>}
            {adaptiveTDEE.isManual && <span style={{fontSize:10,color:C.purple,background:'rgba(167,139,250,0.12)',border:`1px solid ${C.accent}44`,padding:'3px 10px',borderRadius:20,fontWeight:700}}>MANUAL</span>}
          </div>
        </div>
        {!adaptiveTDEE.isManual && (
          <>
            <div style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:`1px solid ${C.borderSoft}`,fontSize:13}}>
              <span style={{color:C.textSub}}>Maintenance TDEE</span>
              <span style={{fontFamily:F.mono,color:C.text}}>{adaptiveTDEE.base} kcal</span>
            </div>
            {adaptiveTDEE.activeCut && (
              <div style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:`1px solid ${C.borderSoft}`,fontSize:13}}>
                <span style={{display:'inline-flex',alignItems:'center',gap:6,color:C.textSub}}><Icon name="compass" size={13} color={C.textSub} /> Incline walk ({adaptiveTDEE.cardioMin} min){adaptiveTDEE.isDataDriven?' (in your data)':''}</span>
                <span style={{fontFamily:F.mono,color:C.teal}}>+{adaptiveTDEE.cardioBurn} kcal</span>
              </div>
            )}
            {adaptiveTDEE.activeCut && (
              <div style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:`1px solid ${C.borderSoft}`,fontSize:13}}>
                <span style={{color:C.textSub}}>Deficit from food</span>
                <span style={{fontFamily:F.mono,color:C.red}}>−{adaptiveTDEE.foodDeficit} kcal</span>
              </div>
            )}
            <div style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:`1px solid ${C.borderSoft}`,fontSize:13}}>
              <span style={{color:C.textSub}}>{adaptiveTDEE.activeCut ? 'Total Daily Deficit' : zigzagOn ? 'Avg Daily Deficit' : 'Daily Deficit'}</span>
              <span style={{fontFamily:F.mono,color:C.red}}>−{adaptiveTDEE.deficit} kcal</span>
            </div>
            {zigzagOn && !isFastingToday && (
              <div style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:`1px solid ${C.borderSoft}`,fontSize:13}}>
                <span style={{color:C.textSub}}>Today's Deficit (zigzag)</span>
                <span style={{fontFamily:F.mono,color:C.red}}>−{dayPlan.deficit} kcal</span>
              </div>
            )}
          </>
        )}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 0 4px',fontSize:15,fontWeight:600}}>
          <span>{isFastingToday ? "Today's Target (Fasting)" : "Today's Target"}</span>
          <span style={{fontFamily:F.mono,color:isFastingToday?C.blue:C.accent,fontSize:24}}>{todayTarget} kcal</span>
        </div>
        {isFastingToday && (
          <div style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:11,color:C.blue,marginBottom:4}}><Icon name="ban" size={12} color={C.blue} /> Fasting day — {planSettings?.fastCompensation ? '25% compensation' : 'full fast'}</div>
        )}
        {zigzagOn && !isFastingToday && (
          <div style={{fontSize:11,color:C.textFaint,marginBottom:4}}>Zigzag — target varies by day, week averages to {adaptiveTDEE.target} kcal</div>
        )}
        {adaptiveTDEE.activeCut && (
          <div style={{marginTop:10,background:'rgba(77,212,192,0.08)',border:`1px solid ${C.teal}33`,borderRadius:12,padding:'11px 14px',fontSize:11.5,color:C.textSub,lineHeight:1.55}}>
            <strong style={{color:C.teal}}>Active Cut</strong> — your incline walk funds {adaptiveTDEE.cardioBurn} kcal of the deficit, so you eat more than a starve-it cut. {adaptiveTDEE.isDataDriven ? 'Now data-driven: your real loss rate already reflects the walking.' : 'First week: the walk is credited from a formula; after that your real data takes over.'}
          </div>
        )}
        <div style={{marginTop:12,display:'flex',alignItems:'center',gap:8,background:'rgba(167,139,250,0.08)',border:`1px solid ${C.accent}33`,borderRadius:12,padding:'11px 14px',fontSize:12,color:C.textSub}}>
          <Icon name="dumbbell" size={15} color={C.protein} /> <span>Protein locked at <strong style={{color:C.protein}}>130g/day</strong> · {adaptiveTDEE.isDataDriven ? 'Calibrated from your real data' : 'Becomes data-driven after ~1 week of logging'}</span>
        </div>
      </div>

      {/* Fasting manager */}
      <div style={card()}>
        <div style={{fontFamily:F.head,fontWeight:700,fontSize:16}}>Fasting Schedule</div>
        <div style={{fontSize:12,color:C.textSub,marginTop:3,lineHeight:1.5}}>
          Choose recurring days. A day is only counted as completed fasting after you confirm it in Today.
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:6,marginTop:14}}>
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((name, dow) => (
            <button key={name} style={{...btn(fastingDays.includes(dow), true), padding:'10px 4px', fontSize:11}}
              onClick={() => toggleFastingDay(dow)} aria-pressed={fastingDays.includes(dow)}>
              {name}
            </button>
          ))}
        </div>
        <label style={{display:'flex',alignItems:'center',gap:9,marginTop:14,fontSize:12.5,color:C.textSub,cursor:'pointer'}}>
          <input type="checkbox" checked={!!planSettings?.fastCompensation}
            onChange={e => onSavePlanSettings?.({...planSettings, fastCompensation:e.target.checked})} />
          Allow 25% calorie compensation on fasting days
        </label>
      </div>

      {/* Regime selector */}
      <div style={card()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontFamily:F.head,fontWeight:700,fontSize:16}}>Diet Regime</div>
            <div style={{fontSize:12,color:C.textSub,marginTop:3}}>How Cut IQ's daily target gets distributed across the week</div>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:14}}>
          <button style={{...btn(!zigzagOn),textAlign:'left',padding:'14px 16px',display:'block',height:'auto'}} onClick={()=>{ setZigzagOn(false); onSaveZigzag?.({on:false,schedule:zigzagSched,mode:zigzagMode}) }}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>Steady{!zigzagOn ? ' ✓' : ''}</div>
            <div style={{fontSize:12,color:!zigzagOn?'#0a0612':C.textSub}}>Same target every day. Simplest, works great.</div>
          </button>
          <button style={{...btn(zigzagOn),textAlign:'left',padding:'14px 16px',display:'block',height:'auto'}} onClick={()=>{ setZigzagOn(true); onSaveZigzag?.({on:true,schedule:zigzagSched,mode:zigzagMode}) }}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>Zigzag{zigzagOn ? ' ✓' : ''}</div>
            <div style={{fontSize:12,color:zigzagOn?'#0a0612':C.textSub}}>Vary daily, same weekly deficit. Better adherence.</div>
          </button>
        </div>
        {zigzagOn && (
          <div style={{marginTop:16}}>
            <div style={{marginBottom:14}}>
              <div style={{...LBL,marginBottom:8}}>Schedule</div>
              <div style={{display:'grid',gridTemplateColumns:mobile?'1fr':'1fr 1fr',gap:8}}>
                {[{id:1,label:'Schedule 1',desc:'High weekends, low weekdays'},{id:2,label:'Schedule 2',desc:'Wave — peaks mid-week'}].map(s => (
                  <button key={s.id} style={{...btn(zigzagSched===s.id,true),textAlign:'left',padding:'11px 14px',display:'block'}} onClick={()=>{setZigzagSched(s.id);onSaveZigzag?.({on:zigzagOn,schedule:s.id,mode:zigzagMode})}}>
                    <div style={{fontWeight:600}}>{s.label}</div>
                    <div style={{fontSize:11,color:zigzagSched===s.id?'#0a0612':C.textSub,marginTop:2}}>{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div style={{marginBottom:16}}>
              <div style={{...LBL,marginBottom:8}}>Intensity</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                {Object.entries(ZIGZAG_LABELS).map(([key,label]) => (
                  <button key={key} style={{...btn(zigzagMode===key,true),textAlign:'center',padding:'9px 6px',fontSize:12}} onClick={()=>{setZigzagMode(key);onSaveZigzag?.({on:zigzagOn,schedule:zigzagSched,mode:key})}}>
                    <div style={{fontWeight:600}}>{label.split('(')[0].trim()}</div>
                    <div style={{fontSize:10,color:zigzagMode===key?'#0a0612':C.textSub,marginTop:2}}>{label.split('(')[1]?.replace(')','')}</div>
                  </button>
                ))}
              </div>
            </div>
            <div style={{...LBL,marginBottom:8}}>This Week</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,minmax(0,1fr))',gap:mobile?3:6}}>
              {dayPlan.week.map((d,i) => (
                <div key={i} style={{textAlign:'center',background:d.isToday?'rgba(167,139,250,0.12)':'rgba(255,255,255,0.02)',border:`1px solid ${d.isToday?C.accent:C.borderSoft}`,borderRadius:10,padding:mobile?'7px 1px':'9px 4px',minWidth:0,overflow:'hidden'}}>
                  <div style={{fontSize:mobile?9.5:10,color:d.isToday?C.accent:C.textSub,fontWeight:d.isToday?700:400,marginBottom:4}}>{d.name}</div>
                  <div style={{fontFamily:F.mono,fontSize:mobile?11:12,color:d.isFast?C.blue:d.isToday?C.accent:C.text}}>{d.isFast?'Fast':d.eat}</div>
                </div>
              ))}
            </div>
            <div style={{marginTop:12,fontSize:11,color:C.textFaint}}>
              Same weekly deficit as Steady — intensity only changes the day-to-day spread. Week averages {dayPlan.baseTarget} kcal/day.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   ROOT APP
═══════════════════════════════════════════════════════════════ */
/* Skeleton loading screen — shimmering card placeholders instead of text */
const skel = (h, x = {}) => ({
  height: h, borderRadius: 16,
  background: `linear-gradient(100deg, ${C.surface} 38%, ${C.surfaceAlt} 50%, ${C.surface} 62%)`,
  backgroundSize: '220% 100%', animation: 'shimmer 1.4s ease-in-out infinite', ...x,
})
const Spin = ({ msg }) => (
  <div style={{ background: C.bg, minHeight: '100vh', fontFamily: F.body }}>
    <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.borderSoft}`, display: 'flex', gap: 14, alignItems: 'center' }}>
      <div style={skel(34, { width: 130, borderRadius: 10 })} />
      <div style={skel(8, { flex: 1, borderRadius: 4 })} />
    </div>
    <div style={{ padding: 16, maxWidth: 980, margin: '0 auto', display: 'grid', gap: 12 }}>
      <div style={skel(96)} />
      <div style={skel(190)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={skel(140)} /><div style={skel(140)} />
      </div>
      <div style={skel(120)} />
    </div>
    <div style={{ textAlign: 'center', color: C.textFaint, fontFamily: F.mono, fontSize: 11, marginTop: 6 }}>{msg}</div>
  </div>
)

export default function App() {
  const mobile = useIsMobile()
  const [session,      setSession]      = useState(undefined)
  const [tab,          setTab]          = useState('today')
  const [setup,        setSetup]        = useState(null)
  const [dataReady,    setDataReady]    = useState(false)
  const [onboarding,   setOnboarding]   = useState(false)
  const [todayLog,     setTodayLog]     = useState(null)
  const [viewDate,     setViewDate]     = useState(todayStr())
  const [allLogs,      setAllLogs]      = useState([])
  const [cutIntel,     setCutIntel]     = useState({ anchor: null, strengthSignal: null, strengthWeek: null, cardioMin: 0 })
  const [mealHistory,  setMealHistory]  = useState([])
  const [customFoods,  setCustomFoods]  = useState([])
  const [recipes,      setRecipes]      = useState([])
  const [planSettings,   setPlanSettings]   = useState({ fastingDays:[], fastCompensation:false })
  const [zigzagSettings, setZigzagSettings] = useState({ on:false, schedule:1, mode:'weight' })

  useEffect(() => {
    if (DEMO) { setSession(demoSession); return }   // skip auth in demo builds
    supabase.auth.getSession().then(({data:{session}}) => setSession(session))
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  const emptyLog = (date = todayStr()) => ({ date, weight:null, sleep:null, sleepQuality:null, steps:null, inclineMin:null, meals:[], notes:'', fasting:false, fastingOverridden:false })

  // single round-trip: pull every day's log at once, newest-sortable
  const loadLogs = async () => (await store.getByPrefix('log:')).sort((a,b)=>a.date.localeCompare(b.date))

  const loadData = useCallback(async () => {
    setDataReady(false)
    const s = await store.get('setup'); setSetup(s)
    if (s) {
      const [td, rawLogs, ci, mh, cf, rs, ps, zs] = await Promise.all([
        store.get(`log:${todayStr()}`), loadLogs(), store.get('cut_intel'),
        store.get('meal_history'), store.getSharedFoods(), store.get('recipes'),
        store.get('plan_settings'), store.get('zigzag_settings'),
      ])
      const loadedPlanSettings = ps || { fastingDays:[], fastCompensation:false }
      const loadedZigzagSettings = zs || { on:false, schedule:1, mode:'weight' }
      const hydratedLogs = rawLogs.map(log => log.planSnapshot ? log : {
        ...log,
        planSnapshot: createPlanSnapshot({ date:log.date, log, setup:s, logs:rawLogs, planSettings:loadedPlanSettings, zigzagSettings:loadedZigzagSettings, source:'reconstructed' }),
      })
      const todayLoaded = hydratedLogs.find(log => log.date === todayStr()) || (td ? {
        ...td,
        planSnapshot: td.planSnapshot || createPlanSnapshot({ date:todayStr(), log:td, setup:s, logs:rawLogs, planSettings:loadedPlanSettings, zigzagSettings:loadedZigzagSettings, source:'reconstructed' }),
      } : emptyLog())
      setTodayLog(todayLoaded)
      setAllLogs(hydratedLogs)
      setCutIntel(ci || { anchor: null, strengthSignal: null, strengthWeek: null, cardioMin: 0 })
      setMealHistory(mh || [])
      setCustomFoods(cf || [])
      setRecipes(rs || [])
      setPlanSettings(loadedPlanSettings)
      setZigzagSettings(loadedZigzagSettings)
      const legacyLogs = hydratedLogs.filter((log, index) => !rawLogs[index].planSnapshot)
      if (legacyLogs.length) await Promise.all(legacyLogs.map(log => store.set(`log:${log.date}`, log)))
    }
    setDataReady(true)
  }, [])

  const loadedForRef = useRef(null)
  useEffect(() => {
    if (session && session.user.id !== loadedForRef.current) {
      loadedForRef.current = session.user.id
      loadData()
    }
    if (!session) loadedForRef.current = null
  }, [session, loadData])

  const saveSetup = async s => {
    await store.set('setup', s); setSetup(s); setOnboarding(false)
    if (!todayLog) {
      setTodayLog(emptyLog()); setAllLogs([])
    }
    // Re-run loadData so adaptive TDEE picks up any changed settings
    // (e.g. activity level, startBF for Katch-McArdle)
    else {
      setAllLogs(await loadLogs())
    }
  }
  // Navigate to a specific day (won't go past today)
  const changeViewDate = async (dateStr) => {
    if (dateStr > todayStr()) return
    const requestId = (viewRequestRef.current += 1)
    setViewDate(dateStr)
    const pending = pendingLogs.current[dateStr]
    if (pending) { setTodayLog(pending); return }
    const existing = allLogs.find(l => l.date === dateStr)
    if (existing) { setTodayLog(existing); return }
    const fromStore = await store.get(`log:${dateStr}`)
    if (requestId !== viewRequestRef.current) return
    setTodayLog(fromStore || emptyLog(dateStr))
  }

  // UI state updates instantly; the network write is debounced per date so
  // fast typing can't fire racing upserts (out-of-order responses could
  // persist a stale value). changeViewDate reads allLogs first, so an
  // unflushed write is never lost by navigating away.
  const logSaveTimers = useRef({})
  const pendingLogs   = useRef({})   // date -> latest unsaved log payload
  const viewRequestRef = useRef(0)
  const persistLog = useCallback(async (date, payload, attempt = 0) => {
    const saved = await store.set(`log:${date}`, payload)
    if (saved || attempt >= 3) {
      if (!saved) console.error(`Unable to save log:${date} after ${attempt + 1} attempts`)
      return saved
    }
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
    return persistLog(date, pendingLogs.current[date] || payload, attempt + 1)
  }, [])
  const saveTodayLog = log => {
    const date = log.date || viewDate
    const previous = allLogs.find(l => l.date === date)
    const fastChanged = previous && (previous.fasting !== log.fasting || previous.fastingOverridden !== log.fastingOverridden)
    let nextLog = log
    if (!log.planSnapshot || fastChanged) {
      nextLog = {
        ...log,
        planSnapshot: createPlanSnapshot({ date, log, setup, logs:allLogs, planSettings, zigzagSettings }),
      }
    }
    setTodayLog(nextLog)
    setAllLogs(prev => { const idx=prev.findIndex(l=>l.date===date); if(idx>=0)return prev.map((l,i)=>i===idx?nextLog:l); return [...prev,nextLog].sort((a,b)=>a.date.localeCompare(b.date)) })
    pendingLogs.current[date] = nextLog
    clearTimeout(logSaveTimers.current[date])
    logSaveTimers.current[date] = setTimeout(() => {
      delete logSaveTimers.current[date]
      const payload = pendingLogs.current[date] || nextLog
      delete pendingLogs.current[date]
      persistLog(date, payload)
    }, 600)
  }
  // Flush any debounced writes when the tab is hidden/closed or App unmounts —
  // otherwise a weigh-in entered <600ms before backgrounding the PWA is lost.
  useEffect(() => {
    const flush = () => {
      for (const date of Object.keys(pendingLogs.current)) {
        clearTimeout(logSaveTimers.current[date])
        delete logSaveTimers.current[date]
        const log = pendingLogs.current[date]
        delete pendingLogs.current[date]
        persistLog(date, log)
      }
    }
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVis)
      flush()
    }
  }, [persistLog])
  const saveCutIntel = async ci => { await store.set('cut_intel', ci); setCutIntel(ci) }
  const saveMealToHistory = async (meal) => {
    const key=meal.name.trim().toLowerCase()
    const existing=mealHistory.find(m=>m.name.trim().toLowerCase()===key)
    let updated=existing
      ? mealHistory.map(m=>m.name.trim().toLowerCase()===key?{...meal,count:(m.count||1)+1,lastUsed:todayStr()}:m)
      : [...mealHistory,{...meal,count:1,lastUsed:todayStr()}]
    updated=updated.sort((a,b)=>(b.count||1)-(a.count||1)).slice(0,100)
    await store.set('meal_history',updated); setMealHistory(updated)
  }
  const recaptureTodayPlan = (nextPlanSettings, nextZigzagSettings) => {
    const date = todayStr()
    const current = todayLog?.date === date ? todayLog : allLogs.find(log => log.date === date)
    if (!current) return
    const next = {
      ...current,
      planSnapshot: createPlanSnapshot({
        date, log: current, setup, logs: allLogs,
        planSettings: nextPlanSettings, zigzagSettings: nextZigzagSettings,
        source: 'recaptured',
      }),
    }
    setTodayLog(prev => prev?.date === date ? next : prev)
    setAllLogs(prev => prev.map(log => log.date === date ? next : log))
    pendingLogs.current[date] = next
    clearTimeout(logSaveTimers.current[date])
    logSaveTimers.current[date] = setTimeout(() => {
      delete logSaveTimers.current[date]
      const payload = pendingLogs.current[date] || next
      delete pendingLogs.current[date]
      persistLog(date, payload)
    }, 0)
  }
  const savePlanSettings = async ps => {
    await store.set('plan_settings', ps)
    setPlanSettings(ps)
    // Historical snapshots stay fixed, but the active day must immediately
    // reflect a schedule change and persist that new snapshot.
    recaptureTodayPlan(ps, zigzagSettings)
  }
  const saveZigzagSettings = async zs => {
    await store.set('zigzag_settings', zs)
    setZigzagSettings(zs)
    // Keep the current day in sync with the newly selected distribution;
    // older days retain the target they actually had when logged.
    recaptureTodayPlan(planSettings, zs)
  }
  const saveCustomFood = async food => {
    await store.addSharedFood(food)
    setCustomFoods(prev => [...prev.filter(f => f.id !== food.id), food])
  }
  const saveRecipes = async rs => { await store.set('recipes', rs); setRecipes(rs) }

  const exportData = async kind => {
    const dl = (content, filename, type) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([content], { type }))
      a.download = filename; a.click(); URL.revokeObjectURL(a.href)
    }
    if (kind === 'csv') {
      const rows = [['date','weight_kg','sleep_h','steps','fasting','cals','protein_g','carbs_g','fat_g','fiber_g','meals']]
      allLogs.forEach(l => {
        const s = f => Math.round((l.meals || []).reduce((a, m) => a + (+m[f] || 0), 0) * 10) / 10
        rows.push([l.date, l.weight ?? '', l.sleep ?? '', l.steps ?? '', l.fasting ? 1 : 0, Math.round(s('cals')), s('protein'), s('carbs'), s('fat'), s('fiber'), (l.meals || []).map(m => m.name).join('; ')])
      })
      dl(rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n'), `cutboard_logs_${todayStr()}.csv`, 'text/csv')
    } else {
      const [workouts, routines] = await Promise.all([store.get('workout_history'), store.get('routines')])
      dl(JSON.stringify({ exportedAt: new Date().toISOString(), setup, logs: allLogs, recipes, mealHistory, cutIntel, planSettings, zigzagSettings, customFoods, workouts, routines }, null, 2),
        `cutboard_backup_${todayStr()}.json`, 'application/json')
    }
  }

  const adaptiveTDEE = useMemo(() => getAdaptiveTDEE(setup, allLogs, planSettings), [setup, allLogs, planSettings])
  // Historical views must use the model state available on that date. A saved
  // snapshot is preferred because it preserves the exact target shown then.
  const historicalTDEE = useMemo(() => getAdaptiveTDEE(setup, allLogs, planSettings, viewDate), [setup, allLogs, planSettings, viewDate])
  const streaks      = useMemo(() => getStreaks(allLogs), [allLogs])

  // Midnight rollover: if the app stays open past midnight while viewing
  // "today", follow the date forward so logs land on the right day.
  const viewDateRef = useRef(viewDate); viewDateRef.current = viewDate
  const changeViewDateRef = useRef(null); changeViewDateRef.current = changeViewDate
  useEffect(() => {
    let last = todayStr()
    const check = () => {
      const t = todayStr()
      if (t !== last) {
        if (viewDateRef.current === last) changeViewDateRef.current?.(t)
        last = t
      }
    }
    const iv = setInterval(check, 60000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(iv); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check) }
  }, [])

  if (session===undefined) return <Spin msg='Loading…' />
  if (!session) return <AuthScreen/>
  if (!dataReady) return <Spin msg='Loading your data…' />
  if (!setup||onboarding) return <Onboarding userEmail={session.user.email} onSave={saveSetup} existing={setup} onCancel={()=>setOnboarding(false)} onExport={exportData} onReset={async()=>{
    if(!confirm('Delete ALL your data and start fresh? This cannot be undone.')) return
    await store.clearAll()
    location.reload()
  }}/>
  if (!todayLog) return <Spin msg='Loading today…' />

  const latestWeight = allLogs.filter(l=>l.weight!=null).at(-1)?.weight ?? setup.startWeight
  // The Cut IQ anchor is THE source of lean mass — a re-anchor (e.g. honest
  // Realme BF reading) must move goal weight everywhere, not just in Cut IQ.
  const cutAnchor    = cutIntel?.anchor || { date: setup.startDate, weight: setup.startWeight, bf: setup.startBF }
  const lbm          = cutAnchor.weight * (1 - cutAnchor.bf / 100)
  const goalWeight   = lbm / (1 - setup.goalBF / 100)
  const bodyComp     = inferBodyComp({ logs: allLogs, anchor: cutAnchor, strengthSignal: cutIntel?.strengthSignal, startDate: setup.startDate })
  const currentBF    = bodyComp?.bf ?? cutAnchor.bf
  const cutLength    = setup.cutLength || 60
  const dayCount     = daysBetween(setup.startDate, todayStr()) + 1
  // days remaining so that dayCount + daysLeft === cutLength (matches the design)
  const daysLeft     = Math.max(0, cutLength - dayCount)

  // ★ THE SINGLE SOURCE OF TRUTH — computed once, passed read-only everywhere ★
  const savedPlan = todayLog.planSnapshot
  const dayTDEE = savedPlan ? { ...historicalTDEE, ...savedPlan } : historicalTDEE
  const computedDayPlan = buildDayPlan({
    baseTarget:   dayTDEE.target,
    // cardio-inclusive maintenance so the displayed deficit = the TOTAL deficit
    maintenance:  dayTDEE.effMaint ?? dayTDEE.base,
    floor:        dayTDEE.bmr,
    regime:       zigzagSettings?.on ? 'zigzag' : 'steady',
    zigzag:       { schedule: zigzagSettings?.schedule || 1, mode: zigzagSettings?.mode || 'weight' },
    fastingDays:  planSettings?.fastingDays || [],
    fastComp:     !!planSettings?.fastCompensation,
    manualFastToday: !!todayLog.fasting,
    overriddenToday: !!todayLog.fastingOverridden,
    dateObj:      new Date(viewDate + 'T12:00:00'),
  })
  const dayPlan = savedPlan?.eatTarget != null
    ? { ...computedDayPlan, ...macrosFromCalories(savedPlan.eatTarget), eatTarget:savedPlan.eatTarget, deficit:savedPlan.deficit ?? computedDayPlan.deficit }
    : computedDayPlan

  return (
    <div style={{background:`radial-gradient(ellipse 120% 80% at 50% -20%, #14101e 0%, ${C.bg} 55%)`,minHeight:'100vh',fontFamily:F.body,color:C.text,
      paddingBottom: mobile ? 'calc(74px + env(safe-area-inset-bottom, 0px))' : 'env(safe-area-inset-bottom, 0px)'}}>
      <Header dayCount={dayCount} daysLeft={daysLeft} cutLength={cutLength} phase={adaptiveTDEE.phase} latestWeight={latestWeight} goalWeight={goalWeight} streak={streaks.logging}
        onSettings={()=>setOnboarding(true)} onLogout={()=>supabase.auth.signOut()}/>
      <TabBar tab={tab} setTab={setTab}/>
      {/* keyed on tab so each switch replays the fade-up entrance */}
      <div key={tab} style={{ animation: 'fadeUp 0.22s ease' }}>
        {tab==='today'     && <TodayTab     log={todayLog} dayPlan={dayPlan} adaptiveTDEE={dayTDEE} onSave={saveTodayLog} setup={setup} allLogs={allLogs} mealHistory={mealHistory} onSaveMealHistory={saveMealToHistory} planSettings={planSettings} zigzagSettings={zigzagSettings} stepTarget={cutIntel?.stepGoal || setup.stepGoal} cardioPlan={cutIntel?.cardioPlan} viewDate={viewDate} onChangeDate={changeViewDate} customFoods={customFoods} onSaveCustomFood={saveCustomFood} recipes={recipes} streaks={streaks}/>}
        {tab==='nutrition' && <NutritionTab log={todayLog} dayPlan={dayPlan} adaptiveTDEE={dayTDEE} allLogs={allLogs} setup={setup} planSettings={planSettings} zigzagSettings={zigzagSettings} recipes={recipes} onSaveRecipes={saveRecipes} customFoods={customFoods}/>}
        {tab==='progress'  && <ProgressTab  logs={allLogs} setup={setup} currentBF={currentBF} goalWeight={goalWeight} dayPlan={dayPlan} adaptiveTDEE={adaptiveTDEE} planSettings={planSettings} zigzagSettings={zigzagSettings} onSaveLog={saveTodayLog}/>}
        {tab==='plan'      && <PlanTab      dayPlan={dayPlan} planSettings={planSettings} onSavePlanSettings={savePlanSettings} adaptiveTDEE={adaptiveTDEE} setup={setup} zigzagSettings={zigzagSettings} onSaveZigzag={saveZigzagSettings}/>}
        {tab==='workout'   && <WorkoutTab />}
        {tab==='cutiq'     && <CutIQTab setup={setup} allLogs={allLogs} adaptiveTDEE={adaptiveTDEE} planSettings={planSettings} cutData={cutIntel} onSaveCutData={saveCutIntel} todayLog={todayLog} recipes={recipes} customFoods={customFoods}/>}
      </div>
    </div>
  )
}
