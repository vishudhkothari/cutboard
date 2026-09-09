import { useState, useEffect, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Area, ComposedChart } from 'recharts'
import { C, F, SHADOW, GLOW, card, btn, inp, LBL, TT, useIsMobile, buzz } from './lib/theme'
import { Icon } from './lib/icons'
import {
  trendWeight, currentTrendWeight, estimateTDEE,
  inferBodyComp, fatFraction, projectGoal, paceController, suggestRefeed, LEARN_DAYS,
  proteinTargetForWeight, isAdjustmentEligible, evaluateMuscleRisk, objectiveE1rmTrend, ENGINE_CONST,
} from './lib/cutEngine'
import { FOOD_DB } from './lib/foodDB'
import { getDayMicronutrients, getNutritionCoach } from './lib/nutrientCoach'

// date-only strings parse as UTC midnight in new Date() — pin to local noon
const fmtD = d => d ? new Date(typeof d === 'string' ? d + 'T12:00:00' : d).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : '—'
const pad2 = n => String(n).padStart(2, '0')
const localDateStr = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return localDateStr(d) }
const daysBetween = (from, to = localDateStr()) => Math.max(0,
  Math.floor((new Date(to + 'T12:00:00') - new Date(from + 'T12:00:00')) / 86400000)
)
const STATUS_COLOR = {
  on_track:C.teal, lever_steps:C.blue, lever_cardio:C.purple, lever_calories:C.orange,
  too_fast:C.orange, muscle_risk:C.red, too_slow:C.gold, learning:C.textSub,
  gaining:C.red, reached:C.teal, movement_adherence:C.orange, movement_hold:C.textSub,
}
const STRENGTH_OPTS = [
  { id:'up',          label:'Up',           desc:'Lifts climbing' },
  { id:'same',        label:'Holding',       desc:'Same as last week' },
  { id:'slight_down', label:'Slight dip',    desc:'A little weaker' },
  { id:'down',        label:'Down',          desc:'Clearly weaker' },
]

export default function CutIQTab({ setup, allLogs, adaptiveTDEE, planSettings, cutData, workoutHistory = [], onSaveCutData, todayLog, recipes = [], customFoods = [] }) {
  // cutData = { anchor, strengthSignal, strengthWeek, cardioMin } — owned by
  // App (single source of truth: the anchor also drives Header/Progress)
  const mobile = useIsMobile()
  const [editAnchor, setEditAnchor] = useState(false)
  const [anchorForm, setAnchorForm] = useState({ weight:'', bf:'' })

  const save = next => onSaveCutData?.(next)

  // ── derived model outputs ──────────────────────────────────
  const trend       = useMemo(()=>trendWeight(allLogs), [allLogs])
  const trendNow    = useMemo(()=>currentTrendWeight(allLogs), [allLogs])
  const weeksIntoCut= setup?.startDate ? daysBetween(setup.startDate) / 7 : 0
  const objectiveE1rm = useMemo(() => objectiveE1rmTrend(workoutHistory, localDateStr()), [workoutHistory])
  const muscleRisk = useMemo(() => evaluateMuscleRisk({ strengthReports: cutData?.strengthReports || [], e1rmTrend: objectiveE1rm }), [cutData?.strengthReports, objectiveE1rm])
  const tdeeEst     = useMemo(()=>estimateTDEE(allLogs, {
    fastingDays: planSettings?.fastingDays || [],
    fastComp: !!planSettings?.fastCompensation,
    fastKcal: planSettings?.fastCompensation ? Math.round((adaptiveTDEE?.target || 0) * 0.25) : 0,
    fatFraction: fatFraction(cutData?.strengthSignal === 'down' && !muscleRisk.confirmed ? null : cutData?.strengthSignal, weeksIntoCut) ?? 0.85,
  }), [allLogs, planSettings, adaptiveTDEE, cutData?.strengthSignal, setup?.startDate, muscleRisk.confirmed, weeksIntoCut])

  const anchor = useMemo(() => cutData?.anchor || (setup ? {
    date: setup.startDate, weight: setup.startWeight, bf: setup.startBF
  } : null), [cutData?.anchor, setup])

  const modeledStrengthSignal = cutData?.strengthSignal === 'down' && !muscleRisk.confirmed ? null : cutData?.strengthSignal
  const bodyComp = useMemo(()=> setup && anchor ? inferBodyComp({
    logs:allLogs, anchor, strengthSignal:modeledStrengthSignal, startDate:setup.startDate
  }) : null, [allLogs, anchor, modeledStrengthSignal, setup])

  const currentBF = bodyComp?.bf ?? anchor?.bf
  const leanMass  = bodyComp?.leanMass ?? (anchor ? anchor.weight * (1 - anchor.bf/100) : null)
  const curWeight = trendNow ?? setup?.startWeight
  const baselineSteps = setup?.stepGoal || 10000
  const currentSteps = cutData?.stepGoal || baselineSteps
  const recentMovement = useMemo(() => {
    const end = localDateStr()
    const startDate = new Date(end + 'T12:00:00')
    startDate.setDate(startDate.getDate() - 6)
    const start = localDateStr(startDate)
    const logs = allLogs.filter(l => l.date >= start && l.date <= end && Number.isFinite(+l.steps) && +l.steps >= 0)
    return { days:logs.length, average:logs.length ? logs.reduce((sum,l) => sum + +l.steps, 0) / logs.length : null }
  }, [allLogs])
  const zone2Progress = useMemo(() => {
    const now = new Date()
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
    const start = localDateStr(weekStart)
    const sessions = allLogs.filter(l => l.date >= start && l.date <= localDateStr() && Array.isArray(l.zone2Sessions))
      .reduce((sum,l) => sum + l.zone2Sessions.filter(s => (typeof s === 'number' ? s : s?.minutes) > 0).length, 0)
    const plan = cutData?.cardioPlan
    return { sessions, required:plan?.sessionsPerWeek || 0 }
  }, [allLogs, cutData?.cardioPlan])
  const stepGoalChangedAt = cutData?.stepGoalChangedAt
  const stepAdjustmentEligible = !stepGoalChangedAt || Math.floor((Date.now() - new Date(stepGoalChangedAt + 'T12:00:00')) / 86400000) >= 7

  const projection = useMemo(()=> setup && leanMass && currentBF ? projectGoal({
    logs:allLogs, currentBF, goalBF:setup.goalBF, currentWeight:curWeight, leanMass
  }) : null, [allLogs, currentBF, setup, curWeight, leanMass])

  const cutLen   = setup?.cutLength || 60
  // Keep this in lockstep with App's header/plan timeline: the start date is
  // day 1, so a 60-day cut has 59 days left on its start day.
  const daysLeft = setup?.startDate ? Math.max(0, cutLen - (daysBetween(setup.startDate) + 1)) : cutLen
  const inMaintenance = adaptiveTDEE?.phase === 'maintenance'

  // 14-day learning gate is a water-clearance CLOCK — measure the calendar
  // span of weigh-ins, not how many entries exist
  const dataSpanDays = useMemo(()=>{
    const w = allLogs.filter(l=>l.weight!=null).sort((a,b)=>a.date.localeCompare(b.date))
    if (!w.length) return 0
    return Math.round((new Date(w[w.length-1].date+'T12:00:00') - new Date(w[0].date+'T12:00:00'))/86400000) + 1
  }, [allLogs])

  const baselineStepAvg = useMemo(() => {
    const values = allLogs.filter(l => l.date <= localDateStr() && Number.isFinite(+l.steps) && +l.steps >= 0)
      .sort((a,b)=>a.date.localeCompare(b.date)).slice(0, 14).map(l => +l.steps)
    return values.length ? values.reduce((s,v)=>s+v,0) / values.length : baselineSteps
  }, [allLogs, baselineSteps])
  const movementAdherence = useMemo(() => {
    const end = localDateStr()
    const start = addDays(end, -13)
    const window = Array.from({ length: 14 }, (_, i) => addDays(start, i))
    const byDate = Object.fromEntries(allLogs.map(l => [l.date, l]))
    const days = window.map(date => byDate[date])
    if (days.some(l => !l || !Number.isFinite(+l.steps))) return 0
    const stepOk = days.every(l => +l.steps >= currentSteps * 0.95)
    const required = cutData?.cardioPlan?.sessionsPerWeek || 0
    const sessions = days.reduce((sum, l) => sum + (Array.isArray(l.zone2Sessions) ? l.zone2Sessions.filter(s => (typeof s === 'number' ? s : s?.minutes) > 0).length : 0), 0)
    return stepOk && sessions >= required * 2 ? 1 : 0
  }, [allLogs, currentSteps, cutData?.cardioPlan?.sessionsPerWeek])
  const pace = useMemo(()=> setup && leanMass ? paceController({
    currentWeight:curWeight, currentBF, goalBF:setup.goalBF, leanMass, daysLeft,
    actualWeeklyRateKg: tdeeEst?.weeklyRateKg ?? 0,
    currentSteps,
    baselineSteps,
    baselineStepAvg,
    userMaxStepBudget: cutData?.userMaxStepBudget || setup?.userMaxStepBudget || ENGINE_CONST.DEFAULT_MAX_STEP_BUDGET,
    currentCardioMin: cutData?.cardioMin || 0,
    strengthSignal: cutData?.strengthSignal,
    muscleRisk,
    dataDays: dataSpanDays,
    hasRate: !!tdeeEst,
    recentAvgSteps: recentMovement.average,
    recentStepDays: recentMovement.days,
    zone2CompletedSessions: zone2Progress.sessions,
    requiredZone2Sessions: zone2Progress.required,
    stepAdjustmentEligible,
    calorieAdjustmentEligible: isAdjustmentEligible(cutData?.lastCalorieChangeAt, localDateStr(), 7),
  }) : null, [setup, leanMass, curWeight, currentBF, daysLeft, tdeeEst, cutData, muscleRisk, dataSpanDays, currentSteps, baselineSteps, baselineStepAvg, recentMovement, zone2Progress, stepAdjustmentEligible])

  // refeed / diet-break advisor (cut phase only — pointless in maintenance)
  const refeed = useMemo(() => !inMaintenance ? suggestRefeed({
    logs: allLogs, weeksIntoCut, maintenance: adaptiveTDEE?.base || 0, currentWeight: curWeight,
    targetCalories: adaptiveTDEE?.target,
    movementAdherence,
  }) : null, [allLogs, weeksIntoCut, adaptiveTDEE?.base, adaptiveTDEE?.target, inMaintenance, curWeight, movementAdherence])

  // weekly strength check-in due?
  const thisWeek = Math.floor(weeksIntoCut)
  const checkInDue = cutData?.strengthWeek !== thisWeek
  const nutritionFoods = useMemo(() => {
    const map = Object.fromEntries(FOOD_DB.map(f => [f.id, f]))
    customFoods.forEach(f => { map[f.id] = f })
    return Object.values(map)
  }, [customFoods])
  const dayNutrition = useMemo(() => getDayMicronutrients(todayLog, { foods:nutritionFoods, recipes, setup }), [todayLog, nutritionFoods, recipes, setup])
  const nutritionCoach = useMemo(() => getNutritionCoach(dayNutrition, nutritionFoods), [dayNutrition, nutritionFoods])

  if (!setup) return <div style={{ textAlign:'center', padding:'60px 0', color:C.textSub }}>Complete setup first</div>

  const chartData = trend.map(t => ({ date:fmtD(t.date), raw:t.raw, trend:t.trend }))

  return (
    <div style={{ padding:mobile?12:20, maxWidth:980, margin:'0 auto', display:'grid', gap:mobile?10:16 }}>

      {/* ─── HERO: Projection ─── */}
      <div style={card({ background:`linear-gradient(165deg, #16111f 0%, #0d0b13 100%)`, border:`1px solid ${C.accent}33` })}>
        <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:16 }}>
          <Icon name="target" size={17} color={C.accent} style={{marginTop:1}} />
          <div style={{ fontFamily:F.head, fontWeight:800, fontSize:17 }}>Cut Intelligence</div>
        </div>

        {projection?.reached ? (
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ display:'flex', justifyContent:'center', marginBottom:8 }}><Icon name="trophy" size={40} color={C.gold} /></div>
            <div style={{ fontFamily:F.head, fontWeight:800, fontSize:22, color:C.teal }}>Goal reached!</div>
          </div>
        ) : projection?.early ? (
          <div style={{ display:'grid', gridTemplateColumns:mobile?'1fr':'1.2fr 1fr', gap:18, alignItems:'center' }}>
            <div>
              <div style={LBL}>Learning your rate</div>
              <div style={{ fontFamily:F.head, fontWeight:800, fontSize:mobile?22:24, color:C.accent, lineHeight:1.15 }}>
                Building your projection
              </div>
              <div style={{ fontSize:12.5, color:C.textSub, marginTop:8, lineHeight:1.5 }}>
                Early weight changes are mostly water and glycogen. I need about a week of trend data before projecting a goal date — sooner than that would be guessing.
              </div>
            </div>
            <div style={{ display:'grid', gap:8 }}>
              {[
                { label:'Current (trend)', val:`${curWeight?.toFixed(1)} kg`, color:C.text },
                { label:'Est. body fat',   val:`${currentBF?.toFixed(1)}%`,   color:C.orange },
                { label:'Goal',            val:`${setup.goalBF}%`,            color:C.teal },
              ].map(s=>(
                <div key={s.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(255,255,255,0.02)', borderRadius:11, padding:'9px 13px' }}>
                  <span style={{ fontSize:12, color:C.textSub }}>{s.label}</span>
                  <span style={{ fontFamily:F.mono, fontSize:15, color:s.color, fontWeight:700 }}>{s.val}</span>
                </div>
              ))}
            </div>
          </div>
        ) : projection?.stalled ? (
          <div style={{ textAlign:'center', padding:'14px 0' }}>
            <div style={{ fontFamily:F.head, fontWeight:800, fontSize:20, color:C.gold }}>Trend is flat right now</div>
            <div style={{ fontSize:13, color:C.textSub, marginTop:6 }}>Not enough downward movement to project. Check the coach panel below.</div>
          </div>
        ) : projection ? (
          <div>
            <div style={LBL}>Projected to hit {setup.goalBF}% body fat</div>
            <div style={{ fontFamily:F.head, fontWeight:800, fontSize:mobile?28:30, color:C.accent, lineHeight:1.1, marginBottom:4 }}>
              {fmtD(projection.dateMid)} <span style={{ fontSize:15, color:C.textSub, fontWeight:600 }}>· in {projection.weeksMid} weeks</span>
            </div>
            <div style={{ fontSize:11.5, color:C.textFaint, marginBottom:16 }}>
              Range {fmtD(projection.dateFast)} – {fmtD(projection.dateSlow)} · goal {projection.goalWeight} kg
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:9 }}>
              {[
                { label:'Current BF', val:`${currentBF?.toFixed(1)}%`,           color:C.orange },
                { label:'kg / week',  val:`${Math.abs(projection.meanRateKg)}`,  color:C.teal },
                { label:'kg to goal', val:`${projection.kgToGo}`,                color:C.accent },
              ].map(s=>(
                <div key={s.label} style={{ textAlign:'center', background:'rgba(255,255,255,0.03)', borderRadius:12, padding:'11px 6px' }}>
                  <div style={{ fontFamily:F.mono, fontSize:17, fontWeight:700, color:s.color }}>{s.val}</div>
                  <div style={{ fontSize:9.5, color:C.textSub, marginTop:4 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ textAlign:'center', padding:'14px 0', color:C.textSub, fontSize:13 }}>
            Log weight daily for ~1 week to unlock your projection.
          </div>
        )}
      </div>

      {/* Nutrition quality is a supporting signal for the cut, not a medical diagnosis. */}
      <div style={card({ borderLeft:`3px solid ${nutritionCoach.length ? C.orange : C.teal}` })}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <div style={{ fontFamily:F.head, fontWeight:700, fontSize:15 }}>Nutrition sufficiency</div>
          <span style={{ fontFamily:F.mono, fontSize:11, color:C.textSub }}>{dayNutrition.mealsWithData}/{dayNutrition.totalMeals} meals mapped</span>
        </div>
        <div style={{ fontSize:12, color:C.textSub, lineHeight:1.5, marginBottom:10 }}>
          Cut IQ uses your logged food data to spot recurring gaps. Low intake is not the same as a clinical deficiency.
        </div>
        {nutritionCoach.length ? nutritionCoach.slice(0,3).map(g=>(
          <div key={g.id} style={{ display:'flex', justifyContent:'space-between', gap:10, padding:'8px 0', borderTop:`1px solid ${C.borderSoft}`, fontSize:12 }}>
            <span style={{ color:C.orange }}>{g.label} · {g.consumed} {g.unit} / {g.target} {g.unit} · {g.percentage}%</span>
            <span style={{ color:C.textSub, textAlign:'right' }}>{g.suggestions[0]?.food.name || 'Add a mapped food'}</span>
          </div>
        )) : <div style={{ fontSize:12, color:C.teal }}>No tracked micronutrient gaps in today’s mapped foods.</div>}
      </div>

      {/* ─── COACH: maintenance mode after the cut window ─── */}
      {inMaintenance && (
        <div style={card({ borderLeft:`3px solid ${C.teal}` })}>
          <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:10 }}>
            <Icon name="flag" size={16} color={C.teal} style={{marginTop:1}} />
            <div style={{ fontFamily:F.head, fontWeight:700, fontSize:15, color:C.teal }}>Cut complete — maintenance mode</div>
          </div>
          <div style={{ display:'grid', gap:7 }}>
            {[
              `Your target is ramping +150 kcal each week (currently ${adaptiveTDEE.target} kcal) until it reaches maintenance (~${adaptiveTDEE.base} kcal).`,
              'The goal now is a FLAT trend line — weight holding steady while eating more.',
              `Keep protein at ${proteinTargetForWeight(curWeight)}g and keep lifting heavy; that's what locks the result in.`,
              'Want to cut again later? Raise the cut length in Settings, or reset with a new start date.',
            ].map((a,i)=>(
              <div key={i} style={{ display:'flex', gap:9, alignItems:'flex-start', fontSize:12.5, color:C.text, opacity:0.85, lineHeight:1.5 }}>
                <span style={{ color:C.teal, flexShrink:0 }}>›</span>{a}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── COACH: Pace controller ─── */}
      {!inMaintenance && pace && (
        <div style={card({ borderLeft:`3px solid ${STATUS_COLOR[pace.status]||C.accent}` })}>
          <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:6 }}>
            <Icon name="compass" size={16} color={STATUS_COLOR[pace.status]||C.accent} style={{marginTop:1}} />
            <div style={{ fontFamily:F.head, fontWeight:700, fontSize:15, color:STATUS_COLOR[pace.status]||C.accent }}>{pace.headline}</div>
          </div>

          {pace.goalTooAggressive && !pace.learning && (
            <div style={{ background:'rgba(240,86,111,0.1)', border:`1px solid ${C.red}33`, borderRadius:11, padding:'11px 14px', fontSize:12.5, color:C.text, lineHeight:1.55, margin:'10px 0' }}>
              <strong style={{ color:C.red }}>Honest take:</strong> hitting {setup.goalBF}% in {daysLeft} days needs {pace.requiredPct}%/wk —
              above the safe muscle-sparing ceiling (~1%/wk). You can push for it, but expect some muscle loss.
              The projection above shows your realistic clean-cut date.
            </div>
          )}

          <div style={{ display:'grid', gap:7, marginTop:10 }}>
            {pace.actions.map((a,i)=>(
              <div key={i} style={{ display:'flex', gap:9, alignItems:'flex-start', fontSize:12.5, color:C.text, opacity:0.85, lineHeight:1.5 }}>
                <span style={{ color:STATUS_COLOR[pace.status]||C.accent, flexShrink:0 }}>›</span>{a}
              </div>
            ))}
          </div>

          {pace.recommendedSteps != null && pace.recommendedSteps !== currentSteps && (
            <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${C.borderSoft}`, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
              <span style={{ fontSize:12, color:C.textSub }}>
                Dynamic step target: <strong style={{ color:C.text }}>{pace.recommendedSteps.toLocaleString()}/day</strong>
              </span>
              <button style={btn(true, true)} onClick={() => save({ ...(cutData || {}), stepGoal:pace.recommendedSteps, stepGoalChangedAt:localDateStr() })}>
                Apply step target
              </button>
            </div>
          )}

          {/* Zone 2 cardio prescription */}
          {pace.cardioRx && (
            <div style={{ marginTop:12, background:'rgba(167,139,250,0.08)', border:`1px solid ${C.purple}33`, borderRadius:12, padding:'13px 15px' }}>
              <div style={{ display:'inline-flex', alignItems:'center', gap:7, fontFamily:F.head, fontWeight:700, fontSize:13, color:C.purple, marginBottom:8 }}><Icon name="compass" size={14} color={C.purple} /> Zone 2 Prescription</div>
              {[
                ['Dose', `${pace.cardioRx.sessions} (${pace.cardioRx.weeklyMin} min/week)`],
                ['Intensity', pace.cardioRx.intensity],
                ['What', pace.cardioRx.what],
                ['When', pace.cardioRx.when],
              ].map(([k,v])=>(
                <div key={k} style={{ display:'flex', gap:10, fontSize:12, marginBottom:5 }}>
                  <span style={{ color:C.textSub, width:64, flexShrink:0 }}>{k}</span>
                  <span style={{ color:C.text }}>{v}</span>
                </div>
              ))}
              <button style={{ ...btn(true, true), marginTop:6 }} onClick={() => save({ ...(cutData || {}), cardioMin:pace.cardioRx.weeklyMin, cardioPlan:pace.cardioRx })}>
                Apply cardio plan to Today
              </button>
            </div>
          )}

          {/* rate readout — only once we have a real measured rate */}
          {!pace.learning && (
            <div style={{ display:'flex', gap:14, marginTop:14, paddingTop:14, borderTop:`1px solid ${C.borderSoft}`, fontSize:11, color:C.textSub, flexWrap:'wrap' }}>
              <span>Need: <strong style={{ color:C.text, fontFamily:F.mono }}>{pace.requiredRateKg} kg/wk</strong></span>
              {pace.actualRateKg != null && <span>Actual: <strong style={{ color:C.teal, fontFamily:F.mono }}>{pace.actualRateKg} kg/wk</strong></span>}
              <span>Safe max: <strong style={{ color:C.text, fontFamily:F.mono }}>{pace.safeRateKg} kg/wk</strong></span>
            </div>
          )}
        </div>
      )}

      {/* ─── Refeed / diet-break advisor ─── */}
      {refeed && (
        <div style={card({ border:`1px solid ${C.gold}55`, background:`linear-gradient(165deg, #1a160d 0%, #100e0a 100%)` })}>
          <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:8 }}>
            <Icon name={refeed.kind === 'break' ? 'flag' : 'beaker'} size={16} color={C.gold} style={{marginTop:1}} />
            <div style={{ fontFamily:F.head, fontWeight:700, fontSize:15, color:C.gold }}>{refeed.headline}</div>
          </div>
          <div style={{ fontSize:12.5, color:C.textSub, lineHeight:1.55, marginBottom:12 }}>{refeed.reason}</div>
          <div style={{ display:'grid', gap:7 }}>
            {refeed.protocol.map((p,i)=>(
              <div key={i} style={{ display:'flex', gap:9, alignItems:'flex-start', fontSize:12.5, color:C.text, opacity:0.85, lineHeight:1.5 }}>
                <span style={{ color:C.gold, flexShrink:0 }}>›</span>{p}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Weekly strength check-in ─── */}
      <div style={card(checkInDue ? { border:`1px solid ${C.accent}55`, boxShadow:GLOW(C.accent) } : {})}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
          <div style={{ fontFamily:F.head, fontWeight:700, fontSize:15 }}>Weekly Strength Check-in</div>
          {checkInDue && <span style={{ fontSize:10, color:C.accent, background:'rgba(167,139,250,0.12)', border:`1px solid ${C.accent}44`, padding:'3px 10px', borderRadius:20, fontWeight:700 }}>DUE</span>}
        </div>
        <div style={{ fontSize:12.5, color:C.textSub, marginBottom:14, lineHeight:1.5 }}>
          Keep logging in Hevy — just tell me how your main lifts feel vs last week. This drives the fat-vs-muscle model.
        </div>
        <div style={{ display:'grid', gridTemplateColumns:mobile?'1fr 1fr':'repeat(4,1fr)', gap:8 }}>
          {STRENGTH_OPTS.map(o=>(
            <button key={o.id} onClick={()=>{ buzz(12); const report={ weekKey:thisWeek, signal:o.id, recordedAt:localDateStr() }; save({ ...cutData, strengthSignal:o.id, strengthWeek:thisWeek, strengthReports:[...(cutData?.strengthReports||[]).filter(r=>r.weekKey!==thisWeek), report] }) }}
              style={{ ...btn(cutData?.strengthSignal===o.id,true), flexDirection:'column', display:'flex', alignItems:'center', gap:3, padding:'12px 6px', textAlign:'center' }}>
              <span style={{ fontWeight:700 }}>{o.label}</span>
              <span style={{ fontSize:10, color:cutData?.strengthSignal===o.id?'#0a0612':C.textSub }}>{o.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ─── Trend weight chart ─── */}
      <div style={card()}>
        <div style={{ fontFamily:F.head, fontWeight:700, fontSize:15, marginBottom:4 }}>Weight Trend</div>
        <div style={{ fontSize:12, color:C.textSub, marginBottom:14 }}>Faint = daily scale · Bold = smoothed trend (ignores water noise)</div>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={210}>
            <ComposedChart data={chartData} margin={{ top:5, right:8, bottom:5, left:-18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.borderSoft} vertical={false} />
              <XAxis dataKey="date" tick={{ fill:C.textSub, fontSize:10 }} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis domain={['dataMin - 0.5','dataMax + 0.5']} tick={{ fill:C.textSub, fontSize:10 }} tickLine={false} axisLine={false} />
              <Tooltip {...TT} />
              <Line type="monotone" dataKey="raw" stroke={C.textFaint} strokeWidth={1} dot={false} name="Scale" />
              <Line type="monotone" dataKey="trend" stroke={C.accent} strokeWidth={2.5} dot={false} name="Trend" />
              {projection?.goalWeight && <ReferenceLine y={projection.goalWeight} stroke={C.teal} strokeDasharray="5 4" label={{ value:`Goal ${projection.goalWeight}kg`, fill:C.teal, fontSize:10, position:'insideTopRight' }} />}
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ textAlign:'center', padding:'30px 0', color:C.textFaint, fontSize:13 }}>Need a few daily weigh-ins to draw the trend.</div>
        )}
      </div>

      {/* ─── Body composition + re-anchor ─── */}
      <div style={card()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div style={{ fontFamily:F.head, fontWeight:700, fontSize:15 }}>Body Composition</div>
          <button style={btn(false,true)} onClick={()=>{ setAnchorForm({ weight:curWeight?.toFixed(1)||'', bf:'' }); setEditAnchor(true) }}>Re-anchor</button>
        </div>
        {bodyComp ? (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:12 }}>
              {[
                { label:'Est. BF%',   val:`${bodyComp.bf}%`,         color:C.orange },
                { label:'Fat lost',   val:`${bodyComp.fatLost} kg`,  color:C.teal },
                { label:'Lean lost',  val:`${bodyComp.leanLost} kg`, color:bodyComp.leanLost>1?C.red:C.textSub },
              ].map(s=>(
                <div key={s.label} style={{ textAlign:'center', background:'rgba(255,255,255,0.02)', borderRadius:12, padding:'14px 8px', border:`1px solid ${C.borderSoft}` }}>
                  <div style={{ fontFamily:F.mono, fontSize:20, fontWeight:700, color:s.color }}>{s.val}</div>
                  <div style={{ fontSize:11, color:C.textSub, marginTop:4 }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize:11.5, color:C.textFaint, lineHeight:1.5 }}>
              Of {bodyComp.massLost} kg lost since anchor, ~{Math.round(bodyComp.fatFractionUsed*100)}% modelled as fat
              {cutData?.strengthSignal ? ` (from your "${STRENGTH_OPTS.find(o=>o.id===cutData.strengthSignal)?.label}" strength signal)` : ' (default — log a strength check-in to refine)'}.
              Scales lie day-to-day; re-anchor from a progress photo or your Realme reading when you trust it.
            </div>
          </>
        ) : (
          <div style={{ fontSize:13, color:C.textSub }}>Set an anchor and log weight to estimate composition.</div>
        )}

        {editAnchor && (
          <div style={{ marginTop:14, background:'rgba(255,255,255,0.02)', borderRadius:12, padding:14, border:`1px solid ${C.border}` }}>
            <div style={{ ...LBL, marginBottom:10 }}>Re-anchor body fat (use your Realme reading or honest visual)</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
              <div><label style={LBL}>Weight (kg)</label><input style={inp()} type="number" inputMode="decimal" step="0.1" value={anchorForm.weight} onChange={e=>setAnchorForm(p=>({...p,weight:e.target.value}))} /></div>
              <div><label style={LBL}>Body fat %</label><input style={inp()} type="number" inputMode="decimal" step="0.1" value={anchorForm.bf} placeholder="e.g. 19" onChange={e=>setAnchorForm(p=>({...p,bf:e.target.value}))} /></div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button style={btn(true,true)} onClick={()=>{
                if(!anchorForm.weight||!anchorForm.bf) return
                if(+anchorForm.bf < 3 || +anchorForm.bf > 70){ alert('Body fat % must be between 3 and 70.'); return }
                if(+anchorForm.weight < 30 || +anchorForm.weight > 300){ alert('Weight must be in kilograms (30–300).'); return }
                save({ ...cutData, anchor:{ date:localDateStr(), weight:+anchorForm.weight, bf:+anchorForm.bf } })
                setEditAnchor(false)
              }}>Save Anchor</button>
              <button style={btn(false,true)} onClick={()=>setEditAnchor(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Live TDEE estimate ─── */}
      {tdeeEst && (
        <div style={card()}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:8, fontFamily:F.head, fontWeight:700, fontSize:15, marginBottom:14 }}><Icon name="beaker" size={16} color={C.accent} /> Live TDEE Estimate</div>
          {tdeeEst.spanDays < LEARN_DAYS ? (
            <div style={{ fontSize:12.5, color:C.textSub, lineHeight:1.55 }}>
              Still learning — a data-driven TDEE needs about a week of logging before it's trustworthy. Until then, your targets use the proven formula estimate (BMR × activity), so they stay stable. <span style={{ color:C.textFaint }}>({tdeeEst.dataPoints} days logged so far.)</span>
            </div>
          ) : (<>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
            {[
              { label:'Real TDEE',   val:`${tdeeEst.tdee}`,       color:C.accent },
              { label:'Avg intake',  val:`${tdeeEst.avgIntake}`,  color:C.text },
              { label:'Rate',        val:`${tdeeEst.weeklyRateKg} kg/wk`, color:tdeeEst.weeklyRateKg<0?C.teal:C.orange },
            ].map(s=>(
              <div key={s.label} style={{ textAlign:'center', background:'rgba(255,255,255,0.02)', borderRadius:12, padding:'14px 8px', border:`1px solid ${C.borderSoft}` }}>
                <div style={{ fontFamily:F.mono, fontSize:19, fontWeight:700, color:s.color }}>{s.val}</div>
                <div style={{ fontSize:11, color:C.textSub, marginTop:4 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize:11.5, color:C.textFaint, marginTop:12, lineHeight:1.5 }}>
            Calculated from {tdeeEst.dataPoints} logged days over {tdeeEst.spanDays} days, using your trend weight (not raw scale). Blended with the formula and clamped for stability.
          </div>
          </>)}
        </div>
      )}

    </div>
  )
}
