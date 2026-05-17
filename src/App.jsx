import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine
} from 'recharts'
import { supabase } from './lib/supabase'
import { store } from './lib/store'

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════ */
const todayStr    = () => new Date().toISOString().slice(0, 10)
const fmtDate     = d  => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
const daysBetween = (a, b) => Math.max(0, Math.floor((new Date(b) - new Date(a)) / 86400000))
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
   Uses nSuns method after 7 days of real data:
   TDEE = avg_calories_eaten + (kg_lost × 7700 / 7)
──────────────────────────────────────────────────────────────── */
function getAdaptiveTDEE(setup, logs) {
  if (!setup) return { target: 1800, base: 2400, adj: 0, curW: 70, deficit: 600, isDataDriven: false }
  const wLogs = logs.filter(l => l.weight != null).sort((a, b) => a.date.localeCompare(b.date))
  const curW  = wLogs.at(-1)?.weight ?? setup.startWeight
  const mult  = ACTIVITY.find(a => a.id === setup.activity)?.mult ?? 1.45
  const formulaTDEE = Math.round(calcBMR(curW, setup.height, setup.age, setup.sex, setup.startBF) * mult)
  let base = formulaTDEE, isDataDriven = false
  const pairedLogs = logs.filter(l => l.weight != null && l.meals?.length > 0).sort((a, b) => a.date.localeCompare(b.date))
  if (pairedLogs.length >= 7) {
    const recent  = pairedLogs.slice(-7)
    const avgCals = recent.reduce((s, l) => s + l.meals.reduce((a, m) => a + (+m.cals || 0), 0), 0) / recent.length
    const wtLost  = recent[0].weight - recent[recent.length - 1].weight
    const dataTDEE = Math.round(avgCals + (wtLost * 7700 / 7))
    if (dataTDEE > 1200 && dataTDEE < 5500) { base = dataTDEE; isDataDriven = true }
  }
  if (setup.manualCalTarget) return { target: +setup.manualCalTarget, base, adj: 0, curW, deficit: base - setup.manualCalTarget, isDataDriven, isManual: true }
  return { target: Math.round(base - 600), base, adj: 0, curW, deficit: 600, isDataDriven }
}

/* ─── ZIGZAG CALORIE CYCLING ─────────────────────────────────────
   Math-based — works correctly for any maintenance calories.

   Schedule 1: Binary  — high (maintenance) on Sun+Sat, low on weekdays
   Schedule 2: Wave    — peaks Wednesday, troughs Sunday
   
   Intensities (avg daily deficit):
     Mild:    −250 kcal/day  (~0.25 kg/wk)
     Weight:  −500 kcal/day  (~0.5 kg/wk)
     Extreme: −1000 kcal/day (~1 kg/wk)
──────────────────────────────────────────────────────────────── */
const AVG_DEFICIT   = { mild: 250, weight: 500, extreme: 1000 }
const S2_MULT       = [2, 4/3, 2/3, 0, 1/3, 1, 5/3]          // Sun–Sat deficit multipliers
const S2_EXT_FLAT   = [1042, 1014, 986, 958, 972, 1000, 1028]  // Extreme wave (compressed)
const MIN_CALS      = 1200

function getZigzagWeek(tdeeBase, schedule, intensity) {
  const avgDef = AVG_DEFICIT[intensity] || 500
  return DAY_NAMES.map((name, dow) => {
    let cals
    if (schedule === 1) {
      const isHigh = dow === 0 || dow === 6
      if (intensity === 'extreme') {
        const lowCals   = Math.max(MIN_CALS, tdeeBase - 1042)
        const highDeficit = (7000 - 5 * (tdeeBase - lowCals)) / 2
        cals = isHigh ? Math.max(MIN_CALS, Math.round(tdeeBase - highDeficit)) : lowCals
      } else {
        cals = isHigh ? tdeeBase : Math.max(MIN_CALS, Math.round(tdeeBase - (avgDef * 7 / 5)))
      }
    } else {
      cals = intensity === 'extreme'
        ? Math.max(MIN_CALS, Math.round(tdeeBase - S2_EXT_FLAT[dow]))
        : Math.max(MIN_CALS, Math.round(tdeeBase - avgDef * S2_MULT[dow]))
    }
    return { name, cals, isToday: new Date().getDay() === dow }
  })
}
function getZigzagTarget(tdeeBase, schedule, intensity) {
  return getZigzagWeek(tdeeBase, schedule, intensity)[new Date().getDay()].cals
}
const ZIGZAG_LABELS = { mild: 'Mild (−250/day avg)', weight: 'Weight (−500/day avg)', extreme: 'Extreme (−1000/day avg)' }

/* ─── CARB CYCLING ───────────────────────────────────────────────*/
function getDayType(setup, dateStr) {
  if (!setup?.carbCycling) return 'standard'
  const dow = new Date(dateStr + 'T12:00:00').getDay()
  const training = setup.trainingDays || [1, 3, 5]
  const dayAfter = training.map(d => (d + 1) % 7)
  if (training.includes(dow)) return 'high'
  if (dayAfter.includes(dow)) return 'moderate'
  return 'low'
}
const DAY_TYPE_META = {
  high:     { label: 'HIGH CARB', color: '#4da8f7', bg: '#0e1e30', border: '#1a4a7a', desc: 'Training day — fuel up with carbs before your workout.' },
  moderate: { label: 'MODERATE',  color: '#b4ff47', bg: '#0a1209', border: '#1a2f12', desc: 'Day after training — moderate carbs support recovery.' },
  low:      { label: 'LOW CARB',  color: '#ff8533', bg: '#1a0e05', border: '#4a2a10', desc: 'Rest day — keep carbs low, let your body burn fat.' },
  standard: { label: 'STANDARD',  color: '#5c6180', bg: '#0d0f14', border: '#1c1f2e', desc: 'Flat daily calorie target.' },
}
function getCarbCycleMacros(dayType, tdeeData) {
  const proteinG   = Math.round(tdeeData.curW * 2.2)
  const proteinCal = proteinG * 4
  const calTargets = { high: tdeeData.base - 400, moderate: tdeeData.base - 600, low: tdeeData.base - 750, standard: tdeeData.target }
  const calTarget  = Math.round(calTargets[dayType] || tdeeData.target)
  const remaining  = Math.max(calTarget - proteinCal, 200)
  const ratios     = { high: { c: 0.60, f: 0.40 }, moderate: { c: 0.40, f: 0.60 }, low: { c: 0.18, f: 0.82 }, standard: { c: 0.40, f: 0.60 } }
  const { c, f }   = ratios[dayType] || ratios.standard
  return { calTarget, proteinG, carbG: Math.round(remaining * c / 4), fatG: Math.round(remaining * f / 9) }
}

/* ─── DYNAMIC STEP GOAL ──────────────────────────────────────────*/
function getDynamicStepGoal(setup, logs, tdeeData) {
  const base      = setup?.stepGoal || 10000
  const yesterday = [...logs].sort((a, b) => a.date.localeCompare(b.date)).filter(l => l.date < todayStr()).at(-1)
  if (!yesterday) return { goal: base, extra: 0, reason: null }
  const yCals   = yesterday.meals?.reduce((s, m) => s + (+m.cals || 0), 0) || 0
  const surplus = yCals - tdeeData.target
  if (surplus <= 100) return { goal: base, extra: 0, reason: null }
  const calPerStep = tdeeData.curW * 0.00061
  const extra      = Math.min(Math.round(surplus / calPerStep), 6000)
  return { goal: base + extra, extra, reason: `+${extra.toLocaleString()} steps to offset ${surplus} extra kcal from yesterday` }
}

/* ─── COACH INSIGHTS ─────────────────────────────────────────────*/
function getCoachInsights(setup, logs, todayLog, tdeeData, dayType, macros, stepData) {
  if (!todayLog) return []
  const meta         = DAY_TYPE_META[dayType]
  const todayCals    = todayLog.meals?.reduce((s, m) => s + (+m.cals || 0), 0) || 0
  const todayProtein = todayLog.meals?.reduce((s, m) => s + (+m.protein || 0), 0) || 0
  const insights     = []
  insights.push({ icon: '🎯', color: meta.color, msg: meta.desc })
  if (stepData.extra > 0) {
    const kcal = Math.round(stepData.extra * tdeeData.curW * 0.00061)
    insights.push({ icon: '👟', color: '#ff8533', msg: `You ate ~${kcal} kcal over target yesterday. Walk ${stepData.extra.toLocaleString()} extra steps today to stay in deficit.` })
  }
  if (todayCals > macros.calTarget * 0.4) {
    const short = macros.proteinG - todayProtein
    if (short > 20) insights.push({ icon: '⚠️', color: '#ff4d6a', msg: `Protein is ${short}g short of today's ${macros.proteinG}g target. Add a protein source to your next meal.` })
  }
  if (todayLog.sleep > 0 && todayLog.sleep < 6.5) {
    insights.push({ icon: '😴', color: '#ff4d6a', msg: `Only ${todayLog.sleep}h sleep. Low sleep raises cortisol and hunger, blunting fat loss. Aim for 7–8h tonight.` })
  }
  const wLogs = logs.filter(l => l.weight).sort((a, b) => a.date.localeCompare(b.date))
  if (wLogs.length >= 7) {
    const r7 = wLogs.slice(-7).map(l => l.weight)
    const p7 = wLogs.slice(-14, -7).map(l => l.weight)
    if (p7.length >= 4) {
      const rAvg = r7.reduce((s, x) => s + x) / r7.length
      const pAvg = p7.reduce((s, x) => s + x) / p7.length
      const wkLoss = pAvg - rAvg
      if (wkLoss < 0.2)      insights.push({ icon: '📉', color: '#ff8533', msg: `Only ${wkLoss.toFixed(2)}kg lost this week (target ~0.5kg). Tighten calories or add 15 min LISS on rest days.` })
      else if (wkLoss > 1.2) insights.push({ icon: '⚡', color: '#4da8f7', msg: `Losing ${wkLoss.toFixed(1)}kg/wk — faster than ideal. Increase carbs on next training day by 50g to protect muscle.` })
      else                   insights.push({ icon: '✅', color: '#b4ff47', msg: `Down ${wkLoss.toFixed(2)}kg this week — right on target. Stay consistent.` })
    }
  }
  if (setup?.carbCycling) {
    if (dayType === 'high') insights.push({ icon: '💡', color: '#a78bfa', msg: `Schedule your workout today. High-carb days are wasted without training — those carbs go to glycogen, not fat.` })
    if (dayType === 'low')  insights.push({ icon: '💡', color: '#a78bfa', msg: `Get a 20–30 min fasted walk this morning. Low-carb + empty stomach = maximum fat oxidation.` })
  }
  return insights.slice(0, 4)
}

/* ═══════════════════════════════════════════════════════════════
   DESIGN TOKENS
═══════════════════════════════════════════════════════════════ */
const C = { bg:'#06070a', surface:'#0d0f14', border:'#1c1f2e', accent:'#b4ff47', text:'#e4e7f2', textSub:'#5c6180', red:'#ff4d6a', orange:'#ff8533', blue:'#4da8f7', purple:'#a78bfa' }
const F = { head:"'Syne', sans-serif", mono:"'Space Mono', monospace", body:"'DM Sans', sans-serif" }
const card = (x = {}) => ({ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px', ...x })
const btn  = (active = false, sm = false) => ({ background: active ? C.accent : 'transparent', color: active ? '#000' : C.text, border: `1px solid ${active ? C.accent : C.border}`, borderRadius: 8, padding: sm ? '6px 14px' : '10px 22px', cursor: 'pointer', fontFamily: F.body, fontSize: sm ? 13 : 14, fontWeight: active ? 600 : 400, transition: 'all 0.15s' })
const inp  = (x = {}) => ({ background: '#0f1118', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', color: C.text, fontFamily: F.body, fontSize: 14, width: '100%', boxSizing: 'border-box', outline: 'none', ...x })
const LBL  = { fontSize: 11, color: C.textSub, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5, display: 'block' }
const TT   = { contentStyle: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: F.body, fontSize: 12, color: C.text }, cursor: { stroke: C.border } }

/* ═══════════════════════════════════════════════════════════════
   AUTH SCREEN
═══════════════════════════════════════════════════════════════ */
function AuthScreen() {
  const [mode, setMode]       = useState('login')
  const [email, setEmail]     = useState('')
  const [pass, setPass]       = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    setError(''); setLoading(true)
    const { error: e } = await (mode === 'login' ? supabase.auth.signInWithPassword({ email, password: pass }) : supabase.auth.signUp({ email, password: pass }))
    if (e) setError(e.message); setLoading(false)
  }
  return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F.body, color: C.text }}>
      <div style={{ width: '100%', maxWidth: 400, padding: 24 }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontFamily: F.head, fontSize: 42, fontWeight: 800, color: C.accent, letterSpacing: '-0.03em', marginBottom: 6 }}>CUTBOARD</div>
          <div style={{ color: C.textSub, fontSize: 14 }}>60-day transformation tracker</div>
        </div>
        <div style={card()}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 28, background: '#0a0c10', borderRadius: 8, padding: 4 }}>
            {['login','signup'].map(m => <button key={m} onClick={() => { setMode(m); setError('') }} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: F.body, fontSize: 13, fontWeight: 500, transition: 'all 0.15s', background: mode === m ? C.surface : 'transparent', color: mode === m ? C.text : C.textSub }}>{m === 'login' ? 'Sign In' : 'Create Account'}</button>)}
          </div>
          <div style={{ display: 'grid', gap: 14 }}>
            <div><label style={LBL}>Email</label><input style={inp()} type="email" value={email} placeholder="you@email.com" onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} /></div>
            <div><label style={LBL}>Password</label><input style={inp()} type="password" value={pass} placeholder="••••••••" onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} /></div>
            {error && <div style={{ background: '#1a0a0c', border: `1px solid ${C.red}33`, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: C.red }}>{error}</div>}
            <button style={{ ...btn(true), width: '100%', padding: '12px 0', fontSize: 15, marginTop: 4 }} onClick={submit} disabled={loading}>{loading ? 'Please wait…' : (mode === 'login' ? 'Sign In' : 'Create Account')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   ONBOARDING
═══════════════════════════════════════════════════════════════ */
function Onboarding({ userEmail, onSave, existing, onCancel }) {
  const [f, setF] = useState({
    name: existing?.name ?? userEmail?.split('@')[0] ?? '', age: existing?.age ?? '', height: existing?.height ?? '',
    sex: existing?.sex ?? 'male', activity: existing?.activity ?? 'mod',
    startWeight: existing?.startWeight ?? '', startBF: existing?.startBF ?? '', goalBF: existing?.goalBF ?? 12,
    startDate: existing?.startDate ?? todayStr(), stepGoal: existing?.stepGoal ?? 10000,
    carbCycling: existing?.carbCycling ?? false, trainingDays: existing?.trainingDays ?? [1,3,5],
    manualCalTarget: existing?.manualCalTarget ?? '',
  })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const toggleDay = d => set('trainingDays', f.trainingDays.includes(d) ? f.trainingDays.filter(x => x !== d) : [...f.trainingDays, d])
  const lbm = f.startWeight && f.startBF ? f.startWeight * (1 - f.startBF / 100) : null
  const goalW = lbm && f.goalBF ? Math.round(lbm / (1 - f.goalBF / 100) * 10) / 10 : null
  const fatLose = goalW ? Math.round((f.startWeight - goalW) * 10) / 10 : null
  const wkRate  = fatLose ? Math.round(fatLose / (60 / 7) * 100) / 100 : null
  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: F.body, color: C.text, padding: '40px 20px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ fontFamily: F.head, fontSize: 28, fontWeight: 800, marginBottom: 6 }}>{existing ? 'Edit Profile' : 'Setup Your Profile'}</div>
        <div style={{ color: C.textSub, fontSize: 14, marginBottom: 36 }}>These numbers power your adaptive TDEE, carb cycling, and coaching.</div>
        <div style={{ display: 'grid', gap: 24 }}>
          <div><label style={LBL}>Your Name</label><input style={inp({ maxWidth: 260 })} value={f.name} placeholder="Vishudh" onChange={e => set('name', e.target.value)} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <div><label style={LBL}>Age</label><input style={inp()} type="number" value={f.age} placeholder="22" onChange={e => set('age', +e.target.value)} /></div>
            <div><label style={LBL}>Height (cm)</label><input style={inp()} type="number" value={f.height} placeholder="175" onChange={e => set('height', +e.target.value)} /></div>
            <div><label style={LBL}>Sex</label><select style={inp()} value={f.sex} onChange={e => set('sex', e.target.value)}><option value="male">Male</option><option value="female">Female</option></select></div>
          </div>
          <div><label style={LBL}>Activity Level</label><div style={{ display: 'grid', gap: 8 }}>{ACTIVITY.map(a => <button key={a.id} style={{ ...btn(f.activity === a.id), textAlign: 'left', width: '100%', padding: '11px 16px' }} onClick={() => set('activity', a.id)}>{a.label}</button>)}</div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <div><label style={LBL}>Start Weight (kg)</label><input style={inp()} type="number" step="0.1" value={f.startWeight} placeholder="74.0" onChange={e => set('startWeight', +e.target.value)} /></div>
            <div><label style={LBL}>Start Body Fat %</label><input style={inp()} type="number" step="0.1" value={f.startBF} placeholder="20" onChange={e => set('startBF', +e.target.value)} /></div>
            <div><label style={LBL}>Goal Body Fat %</label><input style={inp()} type="number" step="0.1" value={f.goalBF} placeholder="12" onChange={e => set('goalBF', +e.target.value)} /></div>
          </div>
          {goalW && (
            <div style={card({ background: '#0a1209', borderColor: '#1a2f12', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', textAlign: 'center', gap: 12 })}>
              {[{val:goalW,unit:'kg',label:'Goal Weight',color:C.accent},{val:fatLose,unit:'kg',label:'Fat to Lose',color:C.orange},{val:lbm?.toFixed(1),unit:'kg',label:'Lean Mass',color:C.blue},{val:wkRate,unit:'kg/wk',label:'Target Rate',color:C.purple}].map(({val,unit,label,color}) => (
                <div key={label}><div style={{fontFamily:F.mono,fontSize:22,fontWeight:700,color,lineHeight:1}}>{val}</div><div style={{fontSize:10,color:C.textSub,marginTop:3,textTransform:'uppercase',letterSpacing:'0.08em'}}>{unit}</div><div style={{fontSize:11,color:C.textSub,marginTop:5}}>{label}</div></div>
              ))}
            </div>
          )}
          <div style={{ maxWidth: 240 }}><label style={LBL}>Base Daily Step Goal</label><input style={inp()} type="number" step="500" value={f.stepGoal} placeholder="10000" onChange={e => set('stepGoal', +e.target.value)} /><div style={{ fontSize: 11, color: C.textSub, marginTop: 6 }}>Extra steps added automatically when you overeat</div></div>
          <div style={card({ background: '#0c0e14' })}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: f.carbCycling ? 20 : 0 }}>
              <div><div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15 }}>Carb Cycling</div><div style={{ fontSize: 12, color: C.textSub, marginTop: 4 }}>High carbs on training days, low on rest days.</div></div>
              <button style={btn(f.carbCycling, true)} onClick={() => set('carbCycling', !f.carbCycling)}>{f.carbCycling ? 'ON' : 'OFF'}</button>
            </div>
            {f.carbCycling && (<div><label style={LBL}>Training days</label><div style={{ display: 'flex', gap: 8 }}>{DAY_NAMES.map((name,i) => <button key={i} style={{ ...btn(f.trainingDays.includes(i), true), flex: 1, padding: '8px 0', fontSize: 12 }} onClick={() => toggleDay(i)}>{name}</button>)}</div></div>)}
          </div>
          <div style={card({ background: '#0c0e14' })}>
            <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Manual Calorie Target</div>
            <div style={{ fontSize: 12, color: C.textSub, marginBottom: 14 }}>Override adaptive TDEE with a fixed number. Leave blank to use the calculated target.</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input style={inp({ maxWidth: 160, fontFamily: F.mono })} type="number" value={f.manualCalTarget} placeholder="e.g. 1800" onChange={e => set('manualCalTarget', e.target.value ? +e.target.value : '')} />
              <span style={{ fontSize: 12, color: C.textSub }}>kcal/day</span>
              {f.manualCalTarget && <button style={btn(false, true)} onClick={() => set('manualCalTarget', '')}>Clear</button>}
            </div>
          </div>
          <div style={{ maxWidth: 200 }}><label style={LBL}>Cut Start Date</label><input style={inp()} type="date" value={f.startDate} onChange={e => set('startDate', e.target.value)} /></div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button style={{ ...btn(true), flex: 1, fontSize: 15, padding: '13px 0' }} onClick={() => onSave(f)}>{existing ? '✓ Save Changes' : '🔥 Start My Cut'}</button>
            {existing && <button style={btn()} onClick={onCancel}>Cancel</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   HEADER
═══════════════════════════════════════════════════════════════ */
function Header({ dayCount, daysLeft, latestWeight, goalWeight, onSettings, onLogout }) {
  const pct = Math.min((dayCount / 60) * 100, 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px', borderBottom: `1px solid ${C.border}`, background: C.bg, flexWrap: 'wrap' }}>
      <div style={{ fontFamily: F.head, fontWeight: 800, fontSize: 20, color: C.accent, letterSpacing: '-0.02em', flexShrink: 0 }}>CUTBOARD</div>
      <div style={{ flex: 1, minWidth: 200, maxWidth: 280 }}>
        <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: C.accent, borderRadius: 2 }} /></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 11, color: C.textSub, fontFamily: F.mono }}><span>Day {dayCount} / 60</span><span>{daysLeft}d remaining</span></div>
      </div>
      <div style={{ flex: 1 }} />
      {latestWeight && <div style={{ fontFamily: F.mono, fontSize: 12, color: C.textSub, flexShrink: 0 }}><span style={{ color: C.text }}>{latestWeight}kg</span><span style={{ margin: '0 8px', color: C.border }}>→</span><span style={{ color: C.accent }}>{goalWeight?.toFixed(1)}kg</span></div>}
      <button style={btn(false, true)} onClick={onSettings}>⚙ Settings</button>
      <button style={{ ...btn(false, true), color: C.textSub }} onClick={onLogout}>Sign Out</button>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   TAB BAR
═══════════════════════════════════════════════════════════════ */
const TABS = [{id:'today',label:'📋 Today'},{id:'nutrition',label:'🥗 Nutrition'},{id:'progress',label:'📈 Progress'},{id:'inbody',label:'🔬 InBody'},{id:'plan',label:'📅 Plan'}]
function TabBar({ tab, setTab }) {
  return <div style={{ display: 'flex', gap: 4, padding: '10px 20px', borderBottom: `1px solid ${C.border}` }}>{TABS.map(t => <button key={t.id} style={{ ...btn(tab === t.id, true), borderRadius: 7 }} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
}

/* ═══════════════════════════════════════════════════════════════
   TODAY TAB
═══════════════════════════════════════════════════════════════ */
function TodayTab({ log, adaptiveTDEE, onSave, setup, allLogs, mealHistory = [], onSaveMealHistory, planSettings }) {
  const [local,        setLocal]        = useState(log)
  const [addOpen,      setAddOpen]      = useState(false)
  const [mf,           setMf]           = useState({ name:'', cals:'', protein:'', carbs:'', fat:'' })
  const [historySearch,setHistorySearch]= useState('')
  const [editIdx,      setEditIdx]      = useState(null)
  const [editForm,     setEditForm]     = useState({})
  const [zigzagOpen,   setZigzagOpen]   = useState(false)
  const [zigzagSched,  setZigzagSched]  = useState(1)
  const [zigzagMode,   setZigzagMode]   = useState('weight')
  const [zigzagOn,     setZigzagOn]     = useState(false)

  useEffect(() => setLocal(log), [log])

  const upd = (k, v) => { const next = { ...local, [k]: v }; setLocal(next); onSave(next) }

  // Fasting: planned day OR manual toggle
  const todayDow       = new Date().getDay()
  const isPlannedFast  = planSettings?.fastingDays?.includes(todayDow) && !local.fastingOverridden
  const isFasting      = local.fasting || isPlannedFast

  const dayType   = getDayType(setup, todayStr())
  const macros    = getCarbCycleMacros(dayType, adaptiveTDEE)
  const stepData  = getDynamicStepGoal(setup, allLogs, adaptiveTDEE)

  const zigzagTarget = zigzagOn ? getZigzagTarget(adaptiveTDEE.base, zigzagSched, zigzagMode) : null
  // Fasting compensation: 25% of normal target on planned fast days
  const fastCompTarget = isPlannedFast && planSettings?.fastCompensation ? Math.round(macros.calTarget * 0.25) : 0
  const calTarget = isFasting
    ? (planSettings?.fastCompensation && fastCompTarget ? fastCompTarget : 0)
    : (zigzagTarget ?? macros.calTarget)

  const insights  = getCoachInsights(setup, allLogs, local, adaptiveTDEE, dayType, macros, stepData)

  const totalCals    = local.meals.reduce((s, m) => s + (+m.cals || 0), 0)
  const totalProtein = local.meals.reduce((s, m) => s + (+m.protein || 0), 0)
  const totalCarbs   = local.meals.reduce((s, m) => s + (+m.carbs || 0), 0)
  const totalFat     = local.meals.reduce((s, m) => s + (+m.fat || 0), 0)
  const remaining    = calTarget > 0 ? calTarget - totalCals : 0
  const pct          = calTarget > 0 ? Math.min((totalCals / calTarget) * 100, 100) : 0

  const addMeal = () => {
    if (!mf.name || !mf.cals) return
    const meal = { name: mf.name, cals: +mf.cals, protein: +mf.protein||0, carbs: +mf.carbs||0, fat: +mf.fat||0 }
    const next = { ...local, meals: [...local.meals, meal] }
    setLocal(next); onSave(next); onSaveMealHistory?.(meal)
    setMf({ name:'', cals:'', protein:'', carbs:'', fat:'' }); setHistorySearch(''); setAddOpen(false)
  }
  const quickAdd = (meal) => {
    const m = { name: meal.name, cals: +meal.cals, protein: +meal.protein||0, carbs: +meal.carbs||0, fat: +meal.fat||0 }
    const next = { ...local, meals: [...local.meals, m] }
    setLocal(next); onSave(next); onSaveMealHistory?.(m)
  }
  const removeMeal = idx => { const next = { ...local, meals: local.meals.filter((_,i) => i!==idx) }; setLocal(next); onSave(next) }
  const startEdit  = idx => { setEditIdx(idx); setEditForm({ ...local.meals[idx] }) }
  const saveEdit   = () => {
    const updated = local.meals.map((m, i) => i === editIdx ? { name: editForm.name, cals: +editForm.cals||0, protein: +editForm.protein||0, carbs: +editForm.carbs||0, fat: +editForm.fat||0 } : m)
    const next = { ...local, meals: updated }; setLocal(next); onSave(next); setEditIdx(null)
  }
  const toggleFasting = () => {
    if (isPlannedFast && !local.fasting) {
      // Override the plan
      upd('fastingOverridden', true)
    } else {
      const next = { ...local, fasting: !local.fasting, fastingOverridden: false, meals: !local.fasting ? [] : local.meals }
      setLocal(next); onSave(next); if (!local.fasting) setAddOpen(false)
    }
  }

  return (
    <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 980, margin: '0 auto' }}>

      {/* Coach Panel */}
      <div style={{ ...card({ background: '#0a0c12' }), gridColumn: '1/-1' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 14 }}>Coach</div>
          {setup?.carbCycling && <span style={{ background: DAY_TYPE_META[dayType].bg, border: `1px solid ${DAY_TYPE_META[dayType].border}`, color: DAY_TYPE_META[dayType].color, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, letterSpacing: '0.1em' }}>{DAY_TYPE_META[dayType].label}</span>}
          {isPlannedFast && <span style={{ background: '#0e1e30', border: '1px solid #1a4a7a', color: C.blue, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, letterSpacing: '0.1em' }}>PLANNED FAST</span>}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {insights.map((ins, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#0d0f16', borderRadius: 8, padding: '10px 12px', border: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{ins.icon}</span>
              <span style={{ fontSize: 12, color: C.textSub, lineHeight: 1.55 }}>{ins.msg}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Calorie Bar */}
      <div style={{ ...card(), gridColumn: '1/-1' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20, marginBottom: 18, textAlign: 'center' }}>
          {isFasting ? (
            <div style={{ gridColumn:'1/-1', display:'flex', alignItems:'center', justifyContent:'center', gap:16, padding:'10px 0' }}>
              <div style={{ fontSize: 36 }}>🚫</div>
              <div>
                <div style={{ fontFamily:F.head, fontWeight:800, fontSize:22, color:C.blue }}>
                  {isPlannedFast && !local.fasting ? 'Planned Fasting Day' : 'Fasting Day'}
                </div>
                <div style={{ fontSize:13, color:C.textSub, marginTop:2 }}>
                  {planSettings?.fastCompensation && fastCompTarget > 0
                    ? `25% compensation — ${fastCompTarget} kcal target`
                    : '0 kcal — full deficit locked in'}
                </div>
              </div>
              {(!planSettings?.fastCompensation || !fastCompTarget) && (
                <div style={{ marginLeft:24, textAlign:'center' }}>
                  <div style={{ fontFamily:F.mono, fontSize:28, fontWeight:700, color:C.accent }}>{adaptiveTDEE.target}</div>
                  <div style={{ fontSize:11, color:C.textSub, textTransform:'uppercase', letterSpacing:'0.08em', marginTop:4 }}>kcal deficit today</div>
                </div>
              )}
            </div>
          ) : (
            [{val:totalCals,label:'Calories In',color:totalCals>calTarget?C.red:C.accent},{val:calTarget,label:"Today's Target",color:C.text},{val:Math.abs(remaining),label:remaining>=0?'Remaining':'Over Target',color:remaining>=0?C.blue:C.red},{val:`${totalProtein}g`,label:'Protein',color:C.orange}].map(({val,label,color}) => (
              <div key={label}><div style={{fontFamily:F.mono,fontSize:32,fontWeight:700,color,lineHeight:1}}>{val}</div><div style={{fontSize:11,color:C.textSub,textTransform:'uppercase',letterSpacing:'0.08em',marginTop:6}}>{label}</div></div>
            ))
          )}
        </div>
        {!isFasting && <>
          <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height:'100%', width:`${pct}%`, background: pct>=100?C.red:pct>=80?C.orange:C.accent, borderRadius:3, transition:'width 0.4s' }} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, fontSize:11, color:C.textSub }}>
            <span>0</span><span style={{ color: pct>=100?C.red:pct>=80?C.orange:C.textSub }}>{Math.round(pct)}% of {calTarget} kcal</span>
          </div>
        </>}
      </div>

      {/* Vitals */}
      <div style={card()}>
        <div style={{ fontFamily:F.head, fontWeight:700, fontSize:15, marginBottom:18 }}>Today's Vitals</div>
        <div style={{ display:'grid', gap:14 }}>
          {[{key:'weight',icon:'⚖',label:'Weight',unit:'kg',step:'0.1',ph:'73.5'},{key:'sleep',icon:'😴',label:'Sleep',unit:'hrs',step:'0.5',ph:'7.5'},{key:'steps',icon:'👟',label:'Steps',unit:'',step:'100',ph:`${stepData.goal.toLocaleString()}`},{key:'deepWork',icon:'🧠',label:'Deep Work',unit:'hrs',step:'0.5',ph:'4'}].map(({key,icon,label,unit,step,ph}) => (
            <div key={key} style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:18,width:26}}>{icon}</span>
              <span style={{color:C.textSub,fontSize:13,flex:1}}>{label}</span>
              <input type="number" step={step} value={local[key]??''} placeholder={ph} onChange={e=>upd(key,e.target.value?+e.target.value:null)} style={inp({width:100,textAlign:'right',fontFamily:F.mono,fontSize:15,padding:'8px 12px'})} />
              {unit && <span style={{fontSize:12,color:C.textSub,width:28}}>{unit}</span>}
            </div>
          ))}
        </div>
        {/* Step goal */}
        <div style={{ marginTop:14, paddingTop:14, borderTop:`1px solid ${C.border}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <span style={{fontSize:12,color:C.textSub}}>Step goal today</span>
            <span style={{fontFamily:F.mono,fontSize:14,color:stepData.extra>0?C.orange:C.accent}}>{stepData.goal.toLocaleString()} steps</span>
          </div>
          {stepData.extra > 0 && <div style={{fontSize:11,color:C.orange,background:'#1a0e05',borderRadius:6,padding:'6px 10px',borderLeft:`3px solid ${C.orange}`,marginBottom:6}}>{stepData.reason}</div>}
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

      {/* TDEE + Macros */}
      <div style={card()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:15}}>{setup?.carbCycling?'Today\'s Macros':'Adaptive TDEE'}</div>
          <div style={{display:'flex',gap:6}}>
            {adaptiveTDEE.isDataDriven && <span style={{fontSize:10,color:C.accent,background:'#0a1209',border:'1px solid #1a2f12',padding:'3px 8px',borderRadius:20,fontWeight:600}}>DATA-DRIVEN</span>}
            {adaptiveTDEE.isManual && <span style={{fontSize:10,color:C.purple,background:'#120e1a',border:'1px solid #2a1a4a',padding:'3px 8px',borderRadius:20,fontWeight:600}}>MANUAL</span>}
          </div>
        </div>
        {setup?.carbCycling && (
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:18}}>
            {[{label:'Protein',val:macros.proteinG,unit:'g',color:C.orange},{label:'Carbs',val:macros.carbG,unit:'g',color:C.blue},{label:'Fat',val:macros.fatG,unit:'g',color:C.purple}].map(({label,val,unit,color}) => (
              <div key={label} style={{textAlign:'center',background:'#0c0e16',borderRadius:8,padding:'12px 8px'}}>
                <div style={{fontFamily:F.mono,fontSize:22,fontWeight:700,color}}>{val}<span style={{fontSize:12}}>{unit}</span></div>
                <div style={{fontSize:11,color:C.textSub,marginTop:4}}>{label}</div>
              </div>
            ))}
          </div>
        )}
        {!adaptiveTDEE.isManual && [{label:'Maintenance TDEE',val:`${adaptiveTDEE.base} kcal`,color:C.text},{label:'Deficit',val:`−${adaptiveTDEE.deficit} kcal`,color:C.red}].map(({label,val,color}) => (
          <div key={label} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:`1px solid ${C.border}`,fontSize:13}}>
            <span style={{color:C.textSub}}>{label}</span><span style={{fontFamily:F.mono,color}}>{val}</span>
          </div>
        ))}
        <div style={{display:'flex',justifyContent:'space-between',padding:'13px 0',fontSize:15,fontWeight:600}}>
          <span>Today's Target</span><span style={{fontFamily:F.mono,color:C.accent,fontSize:22}}>{calTarget > 0 ? calTarget : (zigzagTarget ?? macros.calTarget)} kcal</span>
        </div>
        <div style={{background:'#0a1209',border:'1px solid #1a2f12',borderRadius:8,padding:'10px 14px',fontSize:12,color:C.textSub}}>
          💪 Protein: <strong style={{color:C.orange}}>{macros.proteinG}g/day</strong>&nbsp;&nbsp;|&nbsp;&nbsp;
          {adaptiveTDEE.isDataDriven ? '📊 From your actual data' : '⏳ Data-driven after 7 days'}
        </div>

        {/* Zigzag toggle */}
        <button style={{...btn(zigzagOn,true),width:'100%',marginTop:10,justifyContent:'center',display:'flex',alignItems:'center',gap:8}} onClick={() => { setZigzagOn(o=>!o); setZigzagOpen(o=>!o) }}>
          〰 {zigzagOn ? `Zigzag ON — ${zigzagTarget} kcal today` : 'Zigzag Diet'}
        </button>
        {(zigzagOpen||zigzagOn) && (
          <div style={{marginTop:10,background:'#0c0e16',borderRadius:10,padding:'14px',border:`1px solid ${C.border}`}}>
            <div style={{marginBottom:12}}>
              <div style={{...LBL,marginBottom:8}}>Schedule</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                {[{id:1,label:'Schedule 1',desc:'High weekends, low weekdays'},{id:2,label:'Schedule 2',desc:'Wave — peaks mid-week'}].map(s => (
                  <button key={s.id} style={{...btn(zigzagSched===s.id,true),textAlign:'left',padding:'10px 12px',display:'block'}} onClick={()=>setZigzagSched(s.id)}>
                    <div style={{fontWeight:600}}>{s.label}</div>
                    <div style={{fontSize:11,color:zigzagSched===s.id?'#000':C.textSub,marginTop:2}}>{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div style={{marginBottom:14}}>
              <div style={{...LBL,marginBottom:8}}>Intensity</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                {Object.entries(ZIGZAG_LABELS).map(([key,label]) => (
                  <button key={key} style={{...btn(zigzagMode===key,true),textAlign:'center',padding:'8px 6px',fontSize:12}} onClick={()=>setZigzagMode(key)}>
                    <div style={{fontWeight:600,textTransform:'capitalize'}}>{key}</div>
                    <div style={{fontSize:10,color:zigzagMode===key?'#000':C.textSub,marginTop:2}}>{label.split('(')[1]?.replace(')','')}</div>
                  </button>
                ))}
              </div>
            </div>
            <div style={{...LBL,marginBottom:8}}>This Week</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:6}}>
              {getZigzagWeek(adaptiveTDEE.base,zigzagSched,zigzagMode).map((d,i) => (
                <div key={i} style={{textAlign:'center',background:d.isToday?'#0a1209':'#0d0f18',border:`1px solid ${d.isToday?C.accent:C.border}`,borderRadius:7,padding:'8px 4px'}}>
                  <div style={{fontSize:10,color:d.isToday?C.accent:C.textSub,fontWeight:d.isToday?700:400,marginBottom:4}}>{d.name}</div>
                  <div style={{fontFamily:F.mono,fontSize:12,color:d.isToday?C.accent:C.text}}>{d.cals}</div>
                  <div style={{fontSize:9,color:C.textSub,marginTop:2}}>kcal</div>
                </div>
              ))}
            </div>
            <div style={{marginTop:10,fontSize:11,color:C.textSub}}>
              Avg deficit: <strong style={{color:C.text}}>~{Math.round(adaptiveTDEE.base - getZigzagWeek(adaptiveTDEE.base,zigzagSched,zigzagMode).reduce((s,d)=>s+d.cals,0)/7)} kcal/day</strong> · Helps avoid metabolic adaptation.
            </div>
          </div>
        )}
      </div>

      {/* Meals */}
      <div style={{...card(),gridColumn:'1/-1'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{fontFamily:F.head,fontWeight:700,fontSize:15}}>Meals</div>
            {isFasting && <span style={{background:'#0e1e30',border:'1px solid #1a4a7a',color:C.blue,fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:20}}>{isPlannedFast&&!local.fasting?'PLANNED FAST':'FASTING'}</span>}
          </div>
          <div style={{display:'flex',gap:8}}>
            {!isFasting && <button style={btn(true,true)} onClick={()=>setAddOpen(o=>!o)}>+ Add Meal</button>}
            <button style={{...btn(isFasting,true),...(isFasting?{background:'#0e1e30',borderColor:C.blue,color:C.blue}:{})}} onClick={toggleFasting}>
              {isFasting ? (isPlannedFast&&!local.fasting ? '↩ Override Fast' : '↩ Undo Fast') : '🚫 Fasting Day'}
            </button>
          </div>
        </div>

        {/* Add meal panel */}
        {addOpen && (
          <div style={{...card({background:'#0c0e16',marginBottom:16})}}>
            {mealHistory.length > 0 && (
              <div style={{marginBottom:16}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                  <div style={{fontSize:11,color:C.textSub,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',whiteSpace:'nowrap'}}>Quick Add</div>
                  <input style={inp({flex:1,padding:'6px 12px',fontSize:12})} placeholder="Search previous meals…" value={historySearch} onChange={e=>setHistorySearch(e.target.value)} />
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:8,maxHeight:130,overflowY:'auto'}}>
                  {mealHistory.filter(m=>!historySearch||m.name.toLowerCase().includes(historySearch.toLowerCase())).slice(0,historySearch?20:8).map((m,i) => (
                    <button key={i} onClick={()=>quickAdd(m)} style={{display:'flex',alignItems:'center',gap:8,background:'#13151e',border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 12px',cursor:'pointer',fontFamily:F.body,transition:'all 0.15s',textAlign:'left'}}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor=C.accent;e.currentTarget.style.background='#0e1a0a'}}
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
            <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr',gap:10,marginBottom:12}}>
              {[{k:'name',label:'Food / Meal',ph:'Chicken breast 200g',type:'text'},{k:'cals',label:'Calories',ph:'330',type:'number'},{k:'protein',label:'Protein (g)',ph:'62',type:'number'},{k:'carbs',label:'Carbs (g)',ph:'0',type:'number'},{k:'fat',label:'Fat (g)',ph:'7',type:'number'}].map(({k,label,ph,type}) => (
                <div key={k}><label style={LBL}>{label}</label><input style={inp()} type={type} value={mf[k]} placeholder={ph} onChange={e=>setMf(p=>({...p,[k]:e.target.value}))} /></div>
              ))}
            </div>
            <div style={{display:'flex',gap:10}}><button style={btn(true,true)} onClick={addMeal}>Add</button><button style={btn(false,true)} onClick={()=>{setAddOpen(false);setHistorySearch('')}}>Cancel</button></div>
          </div>
        )}

        {local.meals.length === 0 ? (
          <div style={{textAlign:'center',padding:'40px 0',color:C.textSub,fontSize:14}}>{isFasting?'Fasting — no meals today.':'No meals logged yet — add your first!'}</div>
        ) : (<>
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr 64px',gap:8,padding:'4px 10px',fontSize:11,color:C.textSub,textTransform:'uppercase',letterSpacing:'0.07em'}}>
            {['Food','Calories','Protein','Carbs','Fat',''].map(h=><span key={h}>{h}</span>)}
          </div>
          {local.meals.map((m,i) => editIdx === i ? (
            // Inline edit row
            <div key={i} style={{background:'#0c0e16',borderRadius:8,marginBottom:6,padding:'10px',border:`1px solid ${C.accent}33`}}>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr',gap:8,marginBottom:8}}>
                {[{k:'name',ph:'Food',type:'text'},{k:'cals',ph:'Cal',type:'number'},{k:'protein',ph:'P(g)',type:'number'},{k:'carbs',ph:'C(g)',type:'number'},{k:'fat',ph:'F(g)',type:'number'}].map(({k,ph,type}) => (
                  <input key={k} style={inp({padding:'7px 10px',fontSize:13})} type={type} value={editForm[k]??''} placeholder={ph} onChange={e=>setEditForm(p=>({...p,[k]:e.target.value}))} />
                ))}
              </div>
              <div style={{display:'flex',gap:8}}><button style={btn(true,true)} onClick={saveEdit}>Save</button><button style={btn(false,true)} onClick={()=>setEditIdx(null)}>Cancel</button></div>
            </div>
          ) : (
            <div key={i} style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr 64px',gap:8,padding:'12px 10px',background:'#0c0e16',borderRadius:8,marginBottom:6,alignItems:'center',fontSize:14}}>
              <span>{m.name}</span>
              <span style={{fontFamily:F.mono,color:C.accent}}>{m.cals}</span>
              <span style={{fontFamily:F.mono,color:C.orange}}>{m.protein}g</span>
              <span style={{fontFamily:F.mono,color:C.blue}}>{m.carbs}g</span>
              <span style={{fontFamily:F.mono,color:C.textSub}}>{m.fat}g</span>
              <div style={{display:'flex',gap:4}}>
                <button onClick={()=>startEdit(i)} style={{background:'none',border:'none',color:C.textSub,cursor:'pointer',fontSize:15,padding:'4px 6px',lineHeight:1}}
                  onMouseEnter={e=>e.currentTarget.style.color=C.accent} onMouseLeave={e=>e.currentTarget.style.color=C.textSub}>✎</button>
                <button onClick={()=>removeMeal(i)} style={{background:'none',border:'none',color:C.textSub,cursor:'pointer',fontSize:19,padding:'4px 6px',lineHeight:1}}
                  onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.textSub}>×</button>
              </div>
            </div>
          ))}
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr 64px',gap:8,padding:'10px 10px',borderTop:`1px solid ${C.border}`,marginTop:4,fontSize:13,fontWeight:600}}>
            <span style={{color:C.textSub}}>Total</span>
            <span style={{fontFamily:F.mono,color:C.accent}}>{totalCals}</span>
            <span style={{fontFamily:F.mono,color:C.orange}}>{totalProtein}g</span>
            <span style={{fontFamily:F.mono,color:C.blue}}>{totalCarbs}g</span>
            <span style={{fontFamily:F.mono,color:C.textSub}}>{totalFat}g</span>
            <span/>
          </div>
          {setup?.carbCycling && (
            <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${C.border}`,display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
              {[{label:'Protein',eaten:totalProtein,target:macros.proteinG,color:C.orange},{label:'Carbs',eaten:totalCarbs,target:macros.carbG,color:C.blue},{label:'Fat',eaten:totalFat,target:macros.fatG,color:C.purple}].map(({label,eaten,target,color}) => (
                <div key={label}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:5}}><span style={{color:C.textSub}}>{label}</span><span style={{fontFamily:F.mono,color}}>{eaten}<span style={{color:C.textSub}}>/{target}g</span></span></div>
                  <div style={{height:4,background:C.border,borderRadius:2}}><div style={{height:'100%',width:`${Math.min((eaten/target)*100,100)}%`,background:color,borderRadius:2}} /></div>
                </div>
              ))}
            </div>
          )}
        </>)}
      </div>

      {/* Notes */}
      <div style={{...card(),gridColumn:'1/-1'}}>
        <label style={LBL}>Daily Notes</label>
        <textarea style={{...inp({minHeight:80,resize:'vertical'})}} value={local.notes||''} placeholder="Energy levels? Training session? Hunger? Mood?" onChange={e=>upd('notes',e.target.value)} />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   NUTRITION TAB
═══════════════════════════════════════════════════════════════ */
function NutritionTab({ log, adaptiveTDEE, allLogs, setup }) {
  const sum = fn => log.meals.reduce((s,m)=>s+(fn(m)||0),0)
  const todayCals=sum(m=>+m.cals),todayP=sum(m=>+m.protein),todayC=sum(m=>+m.carbs),todayF=sum(m=>+m.fat)
  const dayType=getDayType(setup,todayStr()),macros=getCarbCycleMacros(dayType,adaptiveTDEE)
  const r7=allLogs.slice(-7)
  const avg7=fn=>r7.length?Math.round(r7.reduce((s,l)=>s+fn(l),0)/r7.length):0
  const avgCals=avg7(l=>l.meals.reduce((s,m)=>s+(+m.cals||0),0))
  const avgProt=avg7(l=>l.meals.reduce((s,m)=>s+(+m.protein||0),0))
  const calHistory=allLogs.slice(-14).map(l=>({date:fmtDate(l.date),cals:l.meals.reduce((s,m)=>s+(+m.cals||0),0)}))
  return (
    <div style={{padding:20,maxWidth:980,margin:'0 auto',display:'grid',gap:16}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
        {[{label:"Today's Calories",val:todayCals,unit:'kcal',color:C.accent},{label:'Target',val:macros.calTarget,unit:'kcal',color:C.text},{label:'7-Day Avg Cals',val:avgCals,unit:'kcal',color:C.blue},{label:'7-Day Avg Protein',val:avgProt,unit:'g',color:C.orange}].map(({label,val,unit,color})=>(
          <div key={label} style={card({textAlign:'center'})}><div style={{fontFamily:F.mono,fontSize:28,fontWeight:700,color,lineHeight:1}}>{val}<span style={{fontSize:13}}> {unit}</span></div><div style={{fontSize:11,color:C.textSub,marginTop:6,textTransform:'uppercase',letterSpacing:'0.07em'}}>{label}</div></div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:16}}>
        <div style={card()}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:18}}>Today's Macros</div>
          {[{name:'Protein',g:todayP,cals:todayP*4,target:macros.proteinG,color:C.orange},{name:'Carbs',g:todayC,cals:todayC*4,target:macros.carbG,color:C.blue},{name:'Fat',g:todayF,cals:todayF*9,target:macros.fatG,color:C.purple}].map(m=>(
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
                <Tooltip {...TT}/><ReferenceLine y={macros.calTarget} stroke={C.red} strokeDasharray="4 4"/>
                <Bar dataKey="cals" fill={C.accent} opacity={0.85} radius={[3,3,0,0]} name="Calories"/>
              </BarChart>
            </ResponsiveContainer>
          ):<div style={{padding:'60px 0',textAlign:'center',color:C.textSub}}>Log meals for a few days to see history</div>}
        </div>
      </div>
      {setup?.carbCycling && (
        <div style={card()}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:16}}>Weekly Carb Cycle Schedule</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:8}}>
            {DAY_NAMES.map((name,i)=>{
              const d=new Date();d.setDate(d.getDate()-d.getDay()+i)
              const dt=getDayType(setup,d.toISOString().slice(0,10)),meta=DAY_TYPE_META[dt],m=getCarbCycleMacros(dt,adaptiveTDEE)
              const isToday=new Date().getDay()===i
              return(<div key={i} style={{textAlign:'center',background:isToday?meta.bg:'#0a0c12',border:`1px solid ${isToday?meta.border:C.border}`,borderRadius:8,padding:'10px 6px'}}>
                <div style={{fontSize:11,color:isToday?meta.color:C.textSub,fontWeight:isToday?700:400,marginBottom:6}}>{name}</div>
                <div style={{fontFamily:F.mono,fontSize:14,color:isToday?meta.color:C.text}}>{m.calTarget}</div>
                <div style={{fontSize:10,color:C.textSub,marginTop:3}}>kcal</div>
                <div style={{fontSize:10,color:meta.color,marginTop:5,fontWeight:600,letterSpacing:'0.06em'}}>{meta.label.split(' ')[0]}</div>
              </div>)
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   PROGRESS TAB
═══════════════════════════════════════════════════════════════ */
function ProgressTab({ logs, setup, inBodyScans, goalWeight }) {
  const latestWeight=logs.filter(l=>l.weight!=null).at(-1)?.weight??setup.startWeight
  const latestBF=inBodyScans.at(-1)?.bf??setup.startBF
  const weightLost=setup.startWeight-latestWeight
  const r7=logs.slice(-7)
  const avgOf=fn=>{const v=r7.filter(fn).map(fn);return v.length?Math.round(v.reduce((s,x)=>s+x)/v.length*10)/10:null}
  const avgSleep=avgOf(l=>l.sleep)
  const avgSteps=(()=>{const v=r7.filter(l=>l.steps).map(l=>l.steps);return v.length?Math.round(v.reduce((s,x)=>s+x)/v.length):null})()
  const avgDW=avgOf(l=>l.deepWork)
  const weightData=logs.filter(l=>l.weight!=null).map(l=>({date:fmtDate(l.date),weight:l.weight,goal:+goalWeight.toFixed(1)}))
  const sleepData=logs.filter(l=>l.sleep!=null).map(l=>({date:fmtDate(l.date),sleep:l.sleep}))
  const stepsData=logs.filter(l=>l.steps!=null).map(l=>({date:fmtDate(l.date),steps:l.steps}))
  const dwData=logs.filter(l=>l.deepWork!=null).map(l=>({date:fmtDate(l.date),hours:l.deepWork}))
  return (
    <div style={{padding:20,maxWidth:980,margin:'0 auto',display:'grid',gap:16}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
        {[{label:'Weight Lost',val:weightLost>=0?`-${weightLost.toFixed(1)}`:`+${Math.abs(weightLost).toFixed(1)}`,unit:'kg',color:weightLost>=0?C.accent:C.red},{label:'Current BF %',val:`${latestBF}`,unit:'%',color:C.orange},{label:'7d Avg Sleep',val:avgSleep??'—',unit:avgSleep?'hrs':'',color:C.blue},{label:'7d Avg Steps',val:avgSteps?avgSteps.toLocaleString():'—',unit:'',color:C.purple}].map(({label,val,unit,color})=>(
          <div key={label} style={card({textAlign:'center'})}><div style={{fontFamily:F.mono,fontSize:28,fontWeight:700,color,lineHeight:1}}>{val}<span style={{fontSize:13}}> {unit}</span></div><div style={{fontSize:11,color:C.textSub,marginTop:6,textTransform:'uppercase',letterSpacing:'0.07em'}}>{label}</div></div>
        ))}
      </div>
      <div style={card()}>
        <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:16}}>Weight Trend</div>
        {weightData.length>0?(
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={weightData} margin={{top:5,right:10,bottom:5,left:-20}}>
              <defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="10%" stopColor={C.accent} stopOpacity={0.2}/><stop offset="95%" stopColor={C.accent} stopOpacity={0}/></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
              <XAxis dataKey="date" tick={{fill:C.textSub,fontSize:11}} tickLine={false} axisLine={false}/>
              <YAxis domain={['auto','auto']} tick={{fill:C.textSub,fontSize:11}} tickLine={false} axisLine={false}/>
              <Tooltip {...TT}/>
              <Area type="monotone" dataKey="weight" stroke={C.accent} fill="url(#wg)" strokeWidth={2.5} dot={{fill:C.accent,r:3,strokeWidth:0}} name="Weight (kg)"/>
              <Line type="monotone" dataKey="goal" stroke={C.red} strokeDasharray="5 5" strokeWidth={1.5} dot={false} name="Goal"/>
            </AreaChart>
          </ResponsiveContainer>
        ):<div style={{padding:'70px 0',textAlign:'center',color:C.textSub}}>Log your weight each day in the Today tab</div>}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        <div style={card()}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:16}}>Sleep (hrs)</div>
          {sleepData.length>1?(
            <ResponsiveContainer width="100%" height={170}>
              <AreaChart data={sleepData} margin={{top:5,right:5,bottom:5,left:-20}}>
                <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="10%" stopColor={C.blue} stopOpacity={0.2}/><stop offset="95%" stopColor={C.blue} stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                <XAxis dataKey="date" tick={{fill:C.textSub,fontSize:10}} tickLine={false} axisLine={false}/>
                <YAxis domain={[4,10]} tick={{fill:C.textSub,fontSize:10}} tickLine={false} axisLine={false}/>
                <Tooltip {...TT}/><ReferenceLine y={7} stroke={C.blue} strokeDasharray="4 4" opacity={0.5}/>
                <Area type="monotone" dataKey="sleep" stroke={C.blue} fill="url(#sg)" strokeWidth={2} dot={{fill:C.blue,r:2,strokeWidth:0}} name="Sleep (hrs)"/>
              </AreaChart>
            </ResponsiveContainer>
          ):<div style={{padding:'50px 0',textAlign:'center',color:C.textSub,fontSize:13}}>Log sleep in Today tab</div>}
        </div>
        <div style={card()}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:16}}>Daily Steps</div>
          {stepsData.length>1?(
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={stepsData} margin={{top:5,right:5,bottom:5,left:-20}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                <XAxis dataKey="date" tick={{fill:C.textSub,fontSize:10}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fill:C.textSub,fontSize:10}} tickLine={false} axisLine={false}/>
                <Tooltip {...TT}/><ReferenceLine y={setup.stepGoal||10000} stroke={C.purple} strokeDasharray="4 4"/>
                <Bar dataKey="steps" fill={C.purple} opacity={0.85} radius={[3,3,0,0]} name="Steps"/>
              </BarChart>
            </ResponsiveContainer>
          ):<div style={{padding:'50px 0',textAlign:'center',color:C.textSub,fontSize:13}}>Log steps in Today tab</div>}
        </div>
      </div>
      {dwData.length>1&&(
        <div style={card()}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:16}}>Deep Work (hrs)</div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={dwData} margin={{top:5,right:5,bottom:5,left:-20}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
              <XAxis dataKey="date" tick={{fill:C.textSub,fontSize:10}} tickLine={false} axisLine={false}/>
              <YAxis tick={{fill:C.textSub,fontSize:10}} tickLine={false} axisLine={false}/>
              <Tooltip {...TT}/><ReferenceLine y={4} stroke={C.orange} strokeDasharray="4 4"/>
              <Bar dataKey="hours" fill={C.orange} opacity={0.85} radius={[3,3,0,0]} name="Hours"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div style={card()}>
        <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:16}}>7-Day Averages</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16,textAlign:'center'}}>
          {[{val:avgSleep,target:7,unit:'hrs',label:'Avg Sleep',color:C.blue},{val:avgSteps?Math.round(avgSteps/1000*10)/10:null,target:(setup.stepGoal||10000)/1000,unit:'k steps',label:'Avg Steps',color:C.purple},{val:avgDW,target:4,unit:'hrs',label:'Avg Deep Work',color:C.orange}].map(({val,target,unit,label,color})=>(
            <div key={label}>
              <div style={{fontFamily:F.mono,fontSize:26,color}}>{val??'—'}{val!=null?` ${unit}`:''}</div>
              <div style={{fontSize:12,color:C.textSub,marginTop:4}}>{label}</div>
              {val!=null&&<div style={{fontSize:11,marginTop:6,color:val>=target?C.accent:C.orange}}>{val>=target?'✓ On track':`Target: ${target} ${unit}`}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   INBODY TAB
═══════════════════════════════════════════════════════════════ */
function InBodyTab({ scans, onAdd, setup }) {
  const [showAdd,setShowAdd]=useState(false)
  const [f,setF]=useState({weight:'',bf:'',muscleMass:'',bmr:'',visceralFat:'',bmi:''})
  const sf=(k,v)=>setF(p=>({...p,[k]:v}))
  const addScan=()=>{
    if(!f.weight||!f.bf)return
    onAdd({date:todayStr(),weight:+f.weight,bf:+f.bf,muscleMass:f.muscleMass?+f.muscleMass:null,bmr:f.bmr?+f.bmr:null,visceralFat:f.visceralFat?+f.visceralFat:null,bmi:f.bmi?+f.bmi:null})
    setF({weight:'',bf:'',muscleMass:'',bmr:'',visceralFat:'',bmi:''});setShowAdd(false)
  }
  const bfData=scans.map(s=>({date:fmtDate(s.date),bf:s.bf,muscle:s.muscleMass}))
  return (
    <div style={{padding:20,maxWidth:980,margin:'0 auto',display:'grid',gap:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontFamily:F.head,fontWeight:800,fontSize:20}}>InBody Scans</div>
        <button style={btn(true,true)} onClick={()=>setShowAdd(o=>!o)}>+ Log Scan</button>
      </div>
      {showAdd&&(
        <div style={card()}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:16}}>New Scan Entry</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:16}}>
            {[{k:'weight',label:'Body Weight (kg)',ph:'74.0'},{k:'bf',label:'Body Fat %',ph:'20.0'},{k:'muscleMass',label:'Skeletal Muscle (kg)',ph:'32.0'},{k:'bmr',label:'BMR (kcal)',ph:'1800'},{k:'visceralFat',label:'Visceral Fat Level',ph:'5'},{k:'bmi',label:'BMI',ph:'24.5'}].map(({k,label,ph})=>(
              <div key={k}><label style={LBL}>{label}</label><input style={inp()} type="number" step="0.1" value={f[k]} placeholder={ph} onChange={e=>sf(k,e.target.value)}/></div>
            ))}
          </div>
          <div style={{display:'flex',gap:10}}><button style={btn(true,true)} onClick={addScan}>Save Scan</button><button style={btn(false,true)} onClick={()=>setShowAdd(false)}>Cancel</button></div>
        </div>
      )}
      {bfData.length>0&&(
        <div style={card()}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:16}}>Body Fat % Trend</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={bfData} margin={{top:5,right:30,bottom:5,left:-20}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
              <XAxis dataKey="date" tick={{fill:C.textSub,fontSize:11}} tickLine={false} axisLine={false}/>
              <YAxis tick={{fill:C.textSub,fontSize:11}} tickLine={false} axisLine={false}/>
              <Tooltip {...TT}/>
              <ReferenceLine y={setup.goalBF} stroke={C.accent} strokeDasharray="5 5" label={{value:`Goal ${setup.goalBF}%`,fill:C.accent,fontSize:11,position:'insideTopRight'}}/>
              <Line type="monotone" dataKey="bf" stroke={C.orange} strokeWidth={2.5} dot={{fill:C.orange,r:4,strokeWidth:0}} name="Body Fat %"/>
              {bfData[0]?.muscle!=null&&<Line type="monotone" dataKey="muscle" stroke={C.blue} strokeWidth={2} dot={{fill:C.blue,r:3,strokeWidth:0}} name="Muscle (kg)"/>}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {scans.length===0?(
        <div style={card({textAlign:'center',padding:'64px 20px'})}><div style={{fontSize:52,marginBottom:16}}>🔬</div><div style={{fontSize:16,marginBottom:8}}>Log your first InBody scan</div><div style={{color:C.textSub,fontSize:13}}>Recommended every 2–3 weeks</div></div>
      ):(
        <div style={{display:'grid',gap:10}}>
          {[...scans].reverse().map((s,i)=>{
            const prev=scans[scans.length-2-i],bfDelta=prev?Math.round((s.bf-prev.bf)*10)/10:null
            return(<div key={i} style={card({display:'grid',gridTemplateColumns:'auto repeat(6,1fr)',gap:16,alignItems:'center'})}>
              <div style={{fontFamily:F.mono,fontSize:12,color:C.textSub,whiteSpace:'nowrap'}}>{fmtDate(s.date)}</div>
              <div><div style={{fontSize:11,color:C.textSub}}>Weight</div><div style={{fontFamily:F.mono,color:C.accent,marginTop:3}}>{s.weight}kg</div></div>
              <div><div style={{fontSize:11,color:C.textSub}}>Body Fat</div><div style={{fontFamily:F.mono,color:C.orange,marginTop:3}}>{s.bf}%{bfDelta!==null&&<span style={{fontSize:11,color:bfDelta<0?C.accent:C.red,marginLeft:6}}>{bfDelta>0?'+':''}{bfDelta}%</span>}</div></div>
              {s.muscleMass&&<div><div style={{fontSize:11,color:C.textSub}}>Muscle</div><div style={{fontFamily:F.mono,color:C.blue,marginTop:3}}>{s.muscleMass}kg</div></div>}
              {s.bmr&&<div><div style={{fontSize:11,color:C.textSub}}>BMR</div><div style={{fontFamily:F.mono,marginTop:3}}>{s.bmr} kcal</div></div>}
              {s.visceralFat&&<div><div style={{fontSize:11,color:C.textSub}}>Visceral</div><div style={{fontFamily:F.mono,marginTop:3}}>Lvl {s.visceralFat}</div></div>}
            </div>)
          })}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   PLAN TAB — Workout calendar + fasting day manager
═══════════════════════════════════════════════════════════════ */
function PlanTab({ planSettings, onSavePlanSettings, workouts, onSaveWorkout }) {
  const today = todayStr()
  const [selectedDate, setSelectedDate] = useState(today)
  const [addingExercise, setAddingExercise] = useState(false)
  const [exForm, setExForm] = useState({ name:'', sets:'', reps:'', weight:'', notes:'' })
  const [editExIdx, setEditExIdx] = useState(null)
  const [editExForm, setEditExForm] = useState({})

  // Current week Mon→Sun
  const weekDates = useMemo(() => {
    const d = new Date(), day = d.getDay() || 7
    const mon = new Date(d); mon.setDate(d.getDate() - day + 1)
    return Array.from({length:7}, (_,i) => { const dd=new Date(mon); dd.setDate(mon.getDate()+i); return dd.toISOString().slice(0,10) })
  }, [])

  const dowOf   = dateStr => new Date(dateStr + 'T12:00:00').getDay()
  const isFast  = dateStr => planSettings?.fastingDays?.includes(dowOf(dateStr))
  const workout = workouts[selectedDate] || { notes:'', exercises:[] }

  const toggleFastDay = dow => {
    const cur = planSettings.fastingDays || []
    onSavePlanSettings({ ...planSettings, fastingDays: cur.includes(dow) ? cur.filter(d=>d!==dow) : [...cur, dow] })
  }
  const updateWorkout  = update => onSaveWorkout(selectedDate, { ...workout, ...update })
  const addExercise    = () => {
    if (!exForm.name) return
    updateWorkout({ exercises: [...workout.exercises, { ...exForm }] })
    setExForm({ name:'', sets:'', reps:'', weight:'', notes:'' }); setAddingExercise(false)
  }
  const removeExercise = idx => updateWorkout({ exercises: workout.exercises.filter((_,i)=>i!==idx) })
  const startEditEx    = idx => { setEditExIdx(idx); setEditExForm({ ...workout.exercises[idx] }) }
  const saveEditEx     = () => {
    updateWorkout({ exercises: workout.exercises.map((ex,i) => i===editExIdx ? editExForm : ex) })
    setEditExIdx(null)
  }

  return (
    <div style={{padding:20,maxWidth:980,margin:'0 auto',display:'grid',gap:16}}>

      {/* Week strip */}
      <div style={card()}>
        <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:14}}>Week at a Glance</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:8}}>
          {weekDates.map((date) => {
            const isToday    = date===today
            const isSelected = date===selectedDate
            const fasting    = isFast(date)
            const hasWorkout = (workouts[date]?.exercises?.length||0) > 0
            const dayName    = DAY_NAMES[dowOf(date)]
            const dayNum     = new Date(date+'T12:00:00').getDate()
            return (
              <button key={date} onClick={()=>setSelectedDate(date)} style={{ background:isSelected?'#0a1209':'#0c0e14', border:`1px solid ${isSelected?C.accent:isToday?C.accent+'44':C.border}`, borderRadius:10, padding:'10px 6px', cursor:'pointer', textAlign:'center', transition:'all 0.15s', fontFamily:F.body }}>
                <div style={{fontSize:11,color:isSelected?C.accent:C.textSub,fontWeight:isToday?700:400,marginBottom:4}}>{dayName}</div>
                <div style={{fontFamily:F.mono,fontSize:16,color:isSelected?C.accent:C.text,marginBottom:6}}>{dayNum}</div>
                <div style={{display:'flex',gap:3,justifyContent:'center',minHeight:8}}>
                  {hasWorkout && <span style={{width:6,height:6,borderRadius:'50%',background:C.purple,display:'block'}}/>}
                  {fasting    && <span style={{width:6,height:6,borderRadius:'50%',background:C.blue,  display:'block'}}/>}
                </div>
              </button>
            )
          })}
        </div>
        <div style={{display:'flex',gap:16,marginTop:10,fontSize:11,color:C.textSub}}>
          <span><span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:C.purple,marginRight:5}}/>Workout logged</span>
          <span><span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:C.blue,marginRight:5}}/>Fasting day</span>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>

        {/* Fasting settings */}
        <div style={card()}>
          <div style={{fontFamily:F.head,fontWeight:700,fontSize:15,marginBottom:16}}>Fasting Days</div>
          <div style={{marginBottom:18}}>
            <label style={LBL}>Recurring fasting days</label>
            <div style={{display:'flex',gap:6}}>
              {DAY_NAMES.map((name,i)=>(
                <button key={i} style={{...btn((planSettings.fastingDays||[]).includes(i),true),flex:1,padding:'8px 0',fontSize:11,...((planSettings.fastingDays||[]).includes(i)?{background:'#0e1e30',borderColor:C.blue,color:C.blue}:{})}} onClick={()=>toggleFastDay(i)}>{name}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={LBL}>On fasting days, calorie target</label>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              <button style={{...btn(!planSettings.fastCompensation,true),textAlign:'left',padding:'10px 12px',display:'block',height:'auto'}} onClick={()=>onSavePlanSettings({...planSettings,fastCompensation:false})}>
                <div style={{fontWeight:600,fontSize:13}}>Full Fast</div>
                <div style={{fontSize:11,color:!planSettings.fastCompensation?'#000':C.textSub,marginTop:2}}>0 kcal — max deficit</div>
              </button>
              <button style={{...btn(planSettings.fastCompensation,true),textAlign:'left',padding:'10px 12px',display:'block',height:'auto'}} onClick={()=>onSavePlanSettings({...planSettings,fastCompensation:true})}>
                <div style={{fontWeight:600,fontSize:13}}>25% Compensation</div>
                <div style={{fontSize:11,color:planSettings.fastCompensation?'#000':C.textSub,marginTop:2}}>Eat 25% of normal target</div>
              </button>
            </div>
          </div>
          {isFast(selectedDate) && (
            <div style={{marginTop:14,padding:'10px 14px',background:'#0e1e30',borderRadius:8,border:'1px solid #1a4a7a',fontSize:12,color:C.blue}}>
              {fmtDate(selectedDate)} is a fasting day. {planSettings.fastCompensation?'You can eat 25% of your normal target.':'Full fast — 0 kcal target.'}
            </div>
          )}
        </div>

        {/* Workout for selected day */}
        <div style={card()}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
            <div>
              <div style={{fontFamily:F.head,fontWeight:700,fontSize:15}}>{fmtDate(selectedDate)}{selectedDate===today?' — Today':''}</div>
              <div style={{fontSize:12,color:C.textSub,marginTop:2}}>{workout.exercises.length>0?`${workout.exercises.length} exercise${workout.exercises.length>1?'s':''} logged`:'No workout logged'}</div>
            </div>
            <button style={btn(true,true)} onClick={()=>setAddingExercise(o=>!o)}>+ Exercise</button>
          </div>

          <div style={{marginBottom:14}}>
            <label style={LBL}>Session Notes</label>
            <textarea style={{...inp({minHeight:60,resize:'vertical',fontSize:13})}} value={workout.notes||''} placeholder="How did the session feel? PRs? Energy levels?" onChange={e=>updateWorkout({notes:e.target.value})} />
          </div>

          {addingExercise && (
            <div style={{background:'#0c0e16',borderRadius:8,padding:12,marginBottom:12,border:`1px solid ${C.border}`}}>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:8,marginBottom:8}}>
                {[{k:'name',ph:'Exercise name'},{k:'sets',ph:'Sets'},{k:'reps',ph:'Reps'},{k:'weight',ph:'kg'}].map(({k,ph})=>(
                  <input key={k} style={inp({padding:'7px 10px',fontSize:13})} value={exForm[k]} placeholder={ph} onChange={e=>setExForm(p=>({...p,[k]:e.target.value}))} />
                ))}
              </div>
              <input style={{...inp({padding:'7px 10px',fontSize:13,marginBottom:8})}} value={exForm.notes} placeholder="Notes — e.g. RPE 8, paused reps, superset" onChange={e=>setExForm(p=>({...p,notes:e.target.value}))} />
              <div style={{display:'flex',gap:8}}><button style={btn(true,true)} onClick={addExercise}>Add</button><button style={btn(false,true)} onClick={()=>setAddingExercise(false)}>Cancel</button></div>
            </div>
          )}

          {workout.exercises.length===0 ? (
            <div style={{textAlign:'center',padding:'24px 0',color:C.textSub,fontSize:13}}>No exercises yet — click "+ Exercise" to log</div>
          ) : (
            <div style={{display:'grid',gap:6}}>
              {workout.exercises.map((ex,i) => editExIdx===i ? (
                <div key={i} style={{background:'#0c0e16',borderRadius:8,padding:10,border:`1px solid ${C.accent}33`}}>
                  <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:8,marginBottom:8}}>
                    {[{k:'name',ph:'Exercise'},{k:'sets',ph:'Sets'},{k:'reps',ph:'Reps'},{k:'weight',ph:'kg'}].map(({k,ph})=>(
                      <input key={k} style={inp({padding:'7px 10px',fontSize:13})} value={editExForm[k]||''} placeholder={ph} onChange={e=>setEditExForm(p=>({...p,[k]:e.target.value}))} />
                    ))}
                  </div>
                  <input style={{...inp({padding:'7px 10px',fontSize:13,marginBottom:8})}} value={editExForm.notes||''} placeholder="Notes" onChange={e=>setEditExForm(p=>({...p,notes:e.target.value}))} />
                  <div style={{display:'flex',gap:8}}><button style={btn(true,true)} onClick={saveEditEx}>Save</button><button style={btn(false,true)} onClick={()=>setEditExIdx(null)}>Cancel</button></div>
                </div>
              ) : (
                <div key={i} style={{display:'grid',gridTemplateColumns:'1fr auto',alignItems:'center',background:'#0c0e14',borderRadius:8,padding:'10px 12px',gap:12}}>
                  <div>
                    <div style={{fontSize:14,color:C.text,fontWeight:500}}>{ex.name}</div>
                    <div style={{fontSize:12,color:C.textSub,marginTop:3}}>
                      {[ex.sets&&`${ex.sets} sets`,ex.reps&&`${ex.reps} reps`,ex.weight&&`${ex.weight}kg`].filter(Boolean).join(' · ')}
                      {ex.notes&&<span style={{marginLeft:8,fontStyle:'italic'}}>{ex.notes}</span>}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:4}}>
                    <button onClick={()=>startEditEx(i)} style={{background:'none',border:'none',color:C.textSub,cursor:'pointer',fontSize:15,padding:'4px 6px'}}
                      onMouseEnter={e=>e.currentTarget.style.color=C.accent} onMouseLeave={e=>e.currentTarget.style.color=C.textSub}>✎</button>
                    <button onClick={()=>removeExercise(i)} style={{background:'none',border:'none',color:C.textSub,cursor:'pointer',fontSize:19,padding:'4px 6px',lineHeight:1}}
                      onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.textSub}>×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   ROOT APP
═══════════════════════════════════════════════════════════════ */
export default function App() {
  const [session,      setSession]      = useState(undefined)
  const [tab,          setTab]          = useState('today')
  const [setup,        setSetup]        = useState(null)
  const [dataReady,    setDataReady]    = useState(false)
  const [onboarding,   setOnboarding]   = useState(false)
  const [todayLog,     setTodayLog]     = useState(null)
  const [allLogs,      setAllLogs]      = useState([])
  const [inBodyScans,  setInBodyScans]  = useState([])
  const [mealHistory,  setMealHistory]  = useState([])
  const [planSettings, setPlanSettings] = useState({ fastingDays:[], fastCompensation:false })
  const [workouts,     setWorkouts]     = useState({})

  useEffect(() => {
    supabase.auth.getSession().then(({data:{session}}) => setSession(session))
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  const emptyLog = () => ({ date:todayStr(), weight:null, sleep:null, sleepQuality:null, steps:null, deepWork:null, meals:[], notes:'', fasting:false, fastingOverridden:false })

  const loadData = useCallback(async () => {
    setDataReady(false)
    const s = await store.get('setup'); setSetup(s)
    if (s) {
      const td   = await store.get(`log:${todayStr()}`); setTodayLog(td || emptyLog())
      const keys = await store.list('log:')
      const logs = (await Promise.all(keys.map(k=>store.get(k)))).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date))
      setAllLogs(logs)
      setInBodyScans(await store.get('inbody') || [])
      setMealHistory(await store.get('meal_history') || [])
      setPlanSettings(await store.get('plan_settings') || { fastingDays:[], fastCompensation:false })
      // Load workouts (last 30 days)
      const wkeys = await store.list('workout:')
      const wmap  = {}
      await Promise.all(wkeys.map(async k => { const v=await store.get(k); if(v) wmap[k.replace('workout:','')] = v }))
      setWorkouts(wmap)
    }
    setDataReady(true)
  }, [])

  useEffect(() => { if (session) loadData() }, [session, loadData])

  const saveSetup = async s => {
    await store.set('setup', s); setSetup(s); setOnboarding(false)
    if (!todayLog) { setTodayLog(emptyLog()); setAllLogs([]); setInBodyScans([]) }
  }
  const saveTodayLog = async log => {
    await store.set(`log:${todayStr()}`, log); setTodayLog(log)
    setAllLogs(prev => { const idx=prev.findIndex(l=>l.date===todayStr()); if(idx>=0)return prev.map((l,i)=>i===idx?log:l); return [...prev,log].sort((a,b)=>a.date.localeCompare(b.date)) })
  }
  const saveInBody = async scan => {
    const updated=[...inBodyScans,scan].sort((a,b)=>a.date.localeCompare(b.date))
    await store.set('inbody',updated); setInBodyScans(updated)
  }
  const saveMealToHistory = async (meal) => {
    const key=meal.name.trim().toLowerCase()
    const existing=mealHistory.find(m=>m.name.trim().toLowerCase()===key)
    let updated=existing
      ? mealHistory.map(m=>m.name.trim().toLowerCase()===key?{...meal,count:(m.count||1)+1,lastUsed:todayStr()}:m)
      : [...mealHistory,{...meal,count:1,lastUsed:todayStr()}]
    updated=updated.sort((a,b)=>(b.count||1)-(a.count||1)).slice(0,100)
    await store.set('meal_history',updated); setMealHistory(updated)
  }
  const savePlanSettings = async ps => {
    await store.set('plan_settings', ps); setPlanSettings(ps)
  }
  const saveWorkout = async (date, workout) => {
    await store.set(`workout:${date}`, workout)
    setWorkouts(prev => ({ ...prev, [date]: workout }))
  }

  const adaptiveTDEE = useMemo(() => getAdaptiveTDEE(setup, allLogs), [setup, allLogs])
  const Spin = s => <div style={{background:C.bg,minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:C.accent,fontFamily:F.mono}}>{s}</div>

  if (session===undefined) return Spin('Loading…')
  if (!session) return <AuthScreen/>
  if (!dataReady) return Spin('Loading your data…')
  if (!setup||onboarding) return <Onboarding userEmail={session.user.email} onSave={saveSetup} existing={setup} onCancel={()=>setOnboarding(false)}/>
  if (!todayLog) return Spin('Loading today…')

  const latestWeight = allLogs.filter(l=>l.weight!=null).at(-1)?.weight ?? setup.startWeight
  const lbm          = setup.startWeight * (1 - setup.startBF / 100)
  const goalWeight   = lbm / (1 - setup.goalBF / 100)
  const dayCount     = daysBetween(setup.startDate, todayStr()) + 1
  const daysLeft     = Math.max(0, 60 - dayCount + 1)

  return (
    <div style={{background:C.bg,minHeight:'100vh',fontFamily:F.body,color:C.text}}>
      <Header dayCount={dayCount} daysLeft={daysLeft} latestWeight={latestWeight} goalWeight={goalWeight}
        onSettings={()=>setOnboarding(true)} onLogout={()=>supabase.auth.signOut()}/>
      <TabBar tab={tab} setTab={setTab}/>
      {tab==='today'     && <TodayTab     log={todayLog} adaptiveTDEE={adaptiveTDEE} onSave={saveTodayLog} setup={setup} allLogs={allLogs} mealHistory={mealHistory} onSaveMealHistory={saveMealToHistory} planSettings={planSettings}/>}
      {tab==='nutrition' && <NutritionTab log={todayLog} adaptiveTDEE={adaptiveTDEE} allLogs={allLogs} setup={setup}/>}
      {tab==='progress'  && <ProgressTab  logs={allLogs} setup={setup} inBodyScans={inBodyScans} goalWeight={goalWeight}/>}
      {tab==='inbody'    && <InBodyTab    scans={inBodyScans} onAdd={saveInBody} setup={setup}/>}
      {tab==='plan'      && <PlanTab      planSettings={planSettings} onSavePlanSettings={savePlanSettings} workouts={workouts} onSaveWorkout={saveWorkout}/>}
    </div>
  )
}
