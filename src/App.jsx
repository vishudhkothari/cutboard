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
const todayStr = () => new Date().toISOString().slice(0, 10)
const fmtDate  = d  => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
const daysBetween = (a, b) => Math.max(0, Math.floor((new Date(b) - new Date(a)) / 86400000))

const ACTIVITY = [
  { id: 'sed',    label: 'Sedentary — desk job, no exercise',      mult: 1.2   },
  { id: 'light',  label: 'Light — 1–3x/week training',            mult: 1.375 },
  { id: 'mod',    label: 'Moderate — 3–5x/week training',         mult: 1.55  },
  { id: 'active', label: 'Very Active — 6–7x/week hard training', mult: 1.725 },
  { id: 'extra',  label: 'Athlete — 2x/day or physical job',      mult: 1.9   },
]

function calcBMR(w, h, age, sex = 'male') {
  return sex === 'male' ? 10*w + 6.25*h - 5*age + 5 : 10*w + 6.25*h - 5*age - 161
}

function getAdaptiveTDEE(setup, logs) {
  if (!setup) return { target: 1800, base: 2400, adj: 0, curW: 70, deficit: 600 }
  const wLogs = logs.filter(l => l.weight != null).sort((a, b) => a.date.localeCompare(b.date))
  const curW  = wLogs.at(-1)?.weight ?? setup.startWeight
  const mult  = ACTIVITY.find(a => a.id === setup.activity)?.mult ?? 1.55
  const base  = Math.round(calcBMR(curW, setup.height, setup.age, setup.sex) * mult)
  let adj = setup.tdeeAdj ?? 0

  if (wLogs.length >= 12) {
    const r7 = wLogs.slice(-7).map(l => l.weight)
    const p7 = wLogs.slice(-14, -7).map(l => l.weight)
    if (r7.length >= 5 && p7.length >= 5) {
      const rAvg = r7.reduce((s, x) => s + x) / r7.length
      const pAvg = p7.reduce((s, x) => s + x) / p7.length
      const wkLoss = pAvg - rAvg
      if (wkLoss > 1.0)   adj = Math.min(adj + 150, 450)
      else if (wkLoss < 0.35) adj = Math.max(adj - 150, -450)
    }
  }
  return { target: Math.round(base - 600 + adj), base, adj, curW, deficit: 600 }
}

/* ═══════════════════════════════════════════════════════════════
   DESIGN TOKENS
═══════════════════════════════════════════════════════════════ */
const C = {
  bg: '#06070a', surface: '#0d0f14', surfaceAlt: '#111420',
  border: '#1c1f2e', accent: '#b4ff47', text: '#e4e7f2',
  textSub: '#5c6180', red: '#ff4d6a', orange: '#ff8533',
  blue: '#4da8f7', purple: '#a78bfa',
}
const F = { head: "'Syne', sans-serif", mono: "'Space Mono', monospace", body: "'DM Sans', sans-serif" }

const card  = (x = {}) => ({ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px', ...x })
const btn   = (active = false, sm = false) => ({
  background: active ? C.accent : 'transparent', color: active ? '#000' : C.text,
  border: `1px solid ${active ? C.accent : C.border}`, borderRadius: 8,
  padding: sm ? '6px 14px' : '10px 22px', cursor: 'pointer',
  fontFamily: F.body, fontSize: sm ? 13 : 14, fontWeight: active ? 600 : 400, transition: 'all 0.15s',
})
const inp   = (x = {}) => ({
  background: '#0f1118', border: `1px solid ${C.border}`, borderRadius: 8,
  padding: '10px 14px', color: C.text, fontFamily: F.body, fontSize: 14,
  width: '100%', boxSizing: 'border-box', outline: 'none', ...x,
})
const LBL   = { fontSize: 11, color: C.textSub, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5, display: 'block' }
const TT    = {
  contentStyle: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: F.body, fontSize: 12, color: C.text },
  cursor: { stroke: C.border },
}

/* ═══════════════════════════════════════════════════════════════
   AUTH SCREEN
═══════════════════════════════════════════════════════════════ */
function AuthScreen() {
  const [mode,    setMode]    = useState('login')   // 'login' | 'signup'
  const [email,   setEmail]   = useState('')
  const [pass,    setPass]    = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setError(''); setLoading(true)
    const fn = mode === 'login'
      ? supabase.auth.signInWithPassword({ email, password: pass })
      : supabase.auth.signUp({ email, password: pass })
    const { error: e } = await fn
    if (e) setError(e.message)
    setLoading(false)
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
            {['login', 'signup'].map(m => (
              <button key={m} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: F.body, fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
                background: mode === m ? C.surface : 'transparent', color: mode === m ? C.text : C.textSub, }}
                onClick={() => { setMode(m); setError('') }}>
                {m === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <label style={LBL}>Email</label>
              <input style={inp()} type="email" value={email} placeholder="you@email.com"
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()} />
            </div>
            <div>
              <label style={LBL}>Password</label>
              <input style={inp()} type="password" value={pass} placeholder="••••••••"
                onChange={e => setPass(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()} />
            </div>

            {error && (
              <div style={{ background: '#1a0a0c', border: `1px solid ${C.red}33`, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: C.red }}>
                {error}
              </div>
            )}

            <button style={{ ...btn(true), width: '100%', padding: '12px 0', fontSize: 15, marginTop: 4 }}
              onClick={submit} disabled={loading}>
              {loading ? 'Please wait…' : (mode === 'login' ? 'Sign In' : 'Create Account')}
            </button>
          </div>

          {mode === 'signup' && (
            <div style={{ marginTop: 16, fontSize: 12, color: C.textSub, textAlign: 'center' }}>
              You'll set up your profile after signing in
            </div>
          )}
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
    name:        existing?.name        ?? userEmail?.split('@')[0] ?? '',
    age:         existing?.age         ?? '',
    height:      existing?.height      ?? '',
    sex:         existing?.sex         ?? 'male',
    activity:    existing?.activity    ?? 'mod',
    startWeight: existing?.startWeight ?? '',
    startBF:     existing?.startBF     ?? '',
    goalBF:      existing?.goalBF      ?? 12,
    startDate:   existing?.startDate   ?? todayStr(),
    tdeeAdj:     existing?.tdeeAdj     ?? 0,
  })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const lbm     = f.startWeight && f.startBF ? f.startWeight * (1 - f.startBF / 100) : null
  const goalW   = lbm && f.goalBF ? Math.round(lbm / (1 - f.goalBF / 100) * 10) / 10 : null
  const fatLose = goalW ? Math.round((f.startWeight - goalW) * 10) / 10 : null
  const wkRate  = fatLose ? Math.round(fatLose / (60 / 7) * 100) / 100 : null

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: F.body, color: C.text, padding: '40px 20px' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <div style={{ fontFamily: F.head, fontSize: 28, fontWeight: 800, marginBottom: 6 }}>
          {existing ? 'Edit Profile' : 'Setup Your Profile'}
        </div>
        <div style={{ color: C.textSub, fontSize: 14, marginBottom: 36 }}>
          These numbers power your adaptive TDEE, goal projections, and weekly check-ins.
        </div>

        <div style={{ display: 'grid', gap: 24 }}>
          <div>
            <label style={LBL}>Your Name</label>
            <input style={inp({ maxWidth: 260 })} value={f.name} placeholder="Vishudh"
              onChange={e => set('name', e.target.value)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <div>
              <label style={LBL}>Age</label>
              <input style={inp()} type="number" value={f.age} placeholder="22" onChange={e => set('age', +e.target.value)} />
            </div>
            <div>
              <label style={LBL}>Height (cm)</label>
              <input style={inp()} type="number" value={f.height} placeholder="175" onChange={e => set('height', +e.target.value)} />
            </div>
            <div>
              <label style={LBL}>Sex</label>
              <select style={inp()} value={f.sex} onChange={e => set('sex', e.target.value)}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
          </div>

          <div>
            <label style={LBL}>Activity Level</label>
            <div style={{ display: 'grid', gap: 8 }}>
              {ACTIVITY.map(a => (
                <button key={a.id} style={{ ...btn(f.activity === a.id), textAlign: 'left', width: '100%', padding: '11px 16px' }}
                  onClick={() => set('activity', a.id)}>{a.label}</button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <div>
              <label style={LBL}>Start Weight (kg)</label>
              <input style={inp()} type="number" step="0.1" value={f.startWeight} placeholder="74.0" onChange={e => set('startWeight', +e.target.value)} />
            </div>
            <div>
              <label style={LBL}>Start Body Fat %</label>
              <input style={inp()} type="number" step="0.1" value={f.startBF} placeholder="20" onChange={e => set('startBF', +e.target.value)} />
            </div>
            <div>
              <label style={LBL}>Goal Body Fat %</label>
              <input style={inp()} type="number" step="0.1" value={f.goalBF} placeholder="12" onChange={e => set('goalBF', +e.target.value)} />
            </div>
          </div>

          <div style={{ maxWidth: 200 }}>
            <label style={LBL}>Cut Start Date</label>
            <input style={inp()} type="date" value={f.startDate} onChange={e => set('startDate', e.target.value)} />
          </div>

          {goalW && (
            <div style={card({ background: '#0a1209', borderColor: '#1a2f12', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', textAlign: 'center', gap: 12 })}>
              {[
                { val: goalW,             unit: 'kg',    label: 'Goal Weight', color: C.accent  },
                { val: fatLose,           unit: 'kg',    label: 'Fat to Lose', color: C.orange  },
                { val: lbm?.toFixed(1),   unit: 'kg',    label: 'Lean Mass',   color: C.blue    },
                { val: wkRate,            unit: 'kg/wk', label: 'Target Rate', color: C.purple  },
              ].map(({ val, unit, label, color }) => (
                <div key={label}>
                  <div style={{ fontFamily: F.mono, fontSize: 24, fontWeight: 700, color, lineHeight: 1 }}>{val}</div>
                  <div style={{ fontSize: 10, color: C.textSub, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{unit}</div>
                  <div style={{ fontSize: 11, color: C.textSub, marginTop: 6 }}>{label}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <button style={{ ...btn(true), flex: 1, fontSize: 15, padding: '13px 0' }} onClick={() => onSave(f)}>
              {existing ? '✓ Save Changes' : '🔥 Start My Cut'}
            </button>
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
function Header({ setup, dayCount, daysLeft, latestWeight, goalWeight, onSettings, onLogout }) {
  const pct = Math.min((dayCount / 60) * 100, 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px', borderBottom: `1px solid ${C.border}`, background: C.bg, flexWrap: 'wrap' }}>
      <div style={{ fontFamily: F.head, fontWeight: 800, fontSize: 20, color: C.accent, letterSpacing: '-0.02em', flexShrink: 0 }}>
        CUTBOARD
      </div>
      <div style={{ flex: 1, minWidth: 200, maxWidth: 280 }}>
        <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: C.accent, borderRadius: 2 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 11, color: C.textSub, fontFamily: F.mono }}>
          <span>Day {dayCount} / 60</span>
          <span>{daysLeft}d remaining</span>
        </div>
      </div>
      <div style={{ flex: 1 }} />
      {latestWeight && (
        <div style={{ fontFamily: F.mono, fontSize: 12, color: C.textSub, flexShrink: 0 }}>
          <span style={{ color: C.text }}>{latestWeight}kg</span>
          <span style={{ margin: '0 8px', color: C.border }}>→</span>
          <span style={{ color: C.accent }}>{goalWeight?.toFixed(1)}kg</span>
        </div>
      )}
      <button style={btn(false, true)} onClick={onSettings}>⚙ Settings</button>
      <button style={{ ...btn(false, true), color: C.textSub }} onClick={onLogout}>Sign Out</button>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   TAB BAR
═══════════════════════════════════════════════════════════════ */
const TABS = [
  { id: 'today',     label: '📋 Today'     },
  { id: 'nutrition', label: '🥗 Nutrition' },
  { id: 'progress',  label: '📈 Progress'  },
  { id: 'inbody',    label: '🔬 InBody'    },
]

function TabBar({ tab, setTab }) {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '10px 20px', borderBottom: `1px solid ${C.border}` }}>
      {TABS.map(t => (
        <button key={t.id} style={{ ...btn(tab === t.id, true), borderRadius: 7 }}
          onClick={() => setTab(t.id)}>{t.label}</button>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   TODAY TAB
═══════════════════════════════════════════════════════════════ */
function TodayTab({ log, adaptiveTDEE, onSave }) {
  const [local,   setLocal]   = useState(log)
  const [addOpen, setAddOpen] = useState(false)
  const [mf,      setMf]      = useState({ name: '', cals: '', protein: '', carbs: '', fat: '' })

  useEffect(() => setLocal(log), [log])

  const upd = (k, v) => {
    const next = { ...local, [k]: v }
    setLocal(next); onSave(next)
  }

  const totalCals    = local.meals.reduce((s, m) => s + (+m.cals || 0), 0)
  const totalProtein = local.meals.reduce((s, m) => s + (+m.protein || 0), 0)
  const totalCarbs   = local.meals.reduce((s, m) => s + (+m.carbs || 0), 0)
  const totalFat     = local.meals.reduce((s, m) => s + (+m.fat || 0), 0)
  const remaining    = adaptiveTDEE.target - totalCals
  const pct          = Math.min((totalCals / adaptiveTDEE.target) * 100, 100)

  const addMeal = () => {
    if (!mf.name || !mf.cals) return
    const next = { ...local, meals: [...local.meals, { name: mf.name, cals: +mf.cals, protein: +mf.protein || 0, carbs: +mf.carbs || 0, fat: +mf.fat || 0 }] }
    setLocal(next); onSave(next)
    setMf({ name: '', cals: '', protein: '', carbs: '', fat: '' }); setAddOpen(false)
  }

  const removeMeal = idx => {
    const next = { ...local, meals: local.meals.filter((_, i) => i !== idx) }
    setLocal(next); onSave(next)
  }

  const toggleFasting = () => {
    const isFasting = !local.fasting
    const next = { ...local, fasting: isFasting, meals: isFasting ? [] : local.meals }
    setLocal(next); onSave(next)
    if (isFasting) setAddOpen(false)
  }

  return (
    <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 980, margin: '0 auto' }}>

      {/* Calorie bar */}
      <div style={{ ...card(), gridColumn: '1 / -1' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 18, textAlign: 'center' }}>
          {local.fasting ? (
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '10px 0' }}>
              <div style={{ fontSize: 36 }}>🚫</div>
              <div>
                <div style={{ fontFamily: F.head, fontWeight: 800, fontSize: 22, color: C.blue }}>Fasting Day</div>
                <div style={{ fontSize: 13, color: C.textSub, marginTop: 2 }}>0 kcal — Full deficit locked in</div>
              </div>
              <div style={{ marginLeft: 24, textAlign: 'center' }}>
                <div style={{ fontFamily: F.mono, fontSize: 28, fontWeight: 700, color: C.accent }}>{adaptiveTDEE.target}</div>
                <div style={{ fontSize: 11, color: C.textSub, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>kcal deficit today</div>
              </div>
            </div>
          ) : (
            [
              { val: totalCals,           label: 'Calories In',          color: totalCals > adaptiveTDEE.target ? C.red : C.accent },
              { val: adaptiveTDEE.target, label: 'Daily Target',         color: C.text   },
              { val: Math.abs(remaining), label: remaining >= 0 ? 'Remaining' : 'Over Target', color: remaining >= 0 ? C.blue : C.red },
              { val: `${totalProtein}g`,  label: 'Protein',              color: C.orange },
            ].map(({ val, label, color }) => (
              <div key={label}>
                <div style={{ fontFamily: F.mono, fontSize: 32, fontWeight: 700, color, lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 11, color: C.textSub, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 6 }}>{label}</div>
              </div>
            ))
          )}
        </div>
        {!local.fasting && (<>
          <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? C.red : C.accent, borderRadius: 3, transition: 'width 0.4s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: C.textSub }}>
            <span>0</span><span>{adaptiveTDEE.target} kcal target</span>
          </div>
        </>)}
      </div>

      {/* Vitals */}
      <div style={card()}>
        <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 18 }}>Today's Vitals</div>
        <div style={{ display: 'grid', gap: 14 }}>
          {[
            { key: 'weight',   icon: '⚖',  label: 'Weight',    unit: 'kg',  step: '0.1', ph: '73.5' },
            { key: 'sleep',    icon: '😴', label: 'Sleep',     unit: 'hrs', step: '0.5', ph: '7.5'  },
            { key: 'steps',    icon: '👟', label: 'Steps',     unit: '',    step: '100', ph: '8000' },
            { key: 'deepWork', icon: '🧠', label: 'Deep Work', unit: 'hrs', step: '0.5', ph: '4'    },
          ].map(({ key, icon, label, unit, step, ph }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18, width: 26 }}>{icon}</span>
              <span style={{ color: C.textSub, fontSize: 13, flex: 1 }}>{label}</span>
              <input type="number" step={step} value={local[key] ?? ''} placeholder={ph}
                onChange={e => upd(key, e.target.value ? +e.target.value : null)}
                style={inp({ width: 94, textAlign: 'right', fontFamily: F.mono, fontSize: 15, padding: '8px 12px' })} />
              {unit && <span style={{ fontSize: 12, color: C.textSub, width: 28 }}>{unit}</span>}
            </div>
          ))}
        </div>
        {local.sleep != null && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <div style={{ ...LBL, marginBottom: 8 }}>Sleep Quality</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['Poor', 'OK', 'Good', 'Great'].map(q => (
                <button key={q} style={{ ...btn(local.sleepQuality === q, true), flex: 1, padding: '5px 0', fontSize: 12 }}
                  onClick={() => upd('sleepQuality', q)}>{q}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Adaptive TDEE */}
      <div style={card()}>
        <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 18 }}>Adaptive TDEE</div>
        {[
          { label: 'Maintenance TDEE', val: `${adaptiveTDEE.base} kcal`, color: C.text },
          { label: 'Base Deficit',     val: `−${adaptiveTDEE.deficit} kcal`, color: C.red },
          ...(adaptiveTDEE.adj !== 0 ? [{ label: 'Weekly Adaptation', val: `${adaptiveTDEE.adj > 0 ? '+' : ''}${adaptiveTDEE.adj} kcal`, color: adaptiveTDEE.adj > 0 ? '#4ade80' : C.orange }] : []),
        ].map(({ label, val, color }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
            <span style={{ color: C.textSub }}>{label}</span>
            <span style={{ fontFamily: F.mono, color }}>{val}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0', fontSize: 15, fontWeight: 600 }}>
          <span>Today's Target</span>
          <span style={{ fontFamily: F.mono, color: C.accent, fontSize: 24 }}>{adaptiveTDEE.target} kcal</span>
        </div>
        <div style={{ background: '#0a1209', border: '1px solid #1a2f12', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: C.textSub }}>
          💪 Protein target: <strong style={{ color: C.orange }}>{Math.round(adaptiveTDEE.curW * 2.2)}g/day</strong> (2.2g/kg)
        </div>
        {adaptiveTDEE.adj === 0 && (
          <div style={{ marginTop: 10, fontSize: 11, color: C.textSub }}>Adaptive adjustments activate after 2 weeks of weigh-ins</div>
        )}
      </div>

      {/* Meals */}
      <div style={{ ...card(), gridColumn: '1 / -1' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15 }}>Meals</div>
            {local.fasting && (
              <span style={{ background: '#0e1e30', border: '1px solid #1a4a7a', color: C.blue, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, letterSpacing: '0.06em' }}>
                FASTING
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!local.fasting && <button style={btn(true, true)} onClick={() => setAddOpen(o => !o)}>+ Add Meal</button>}
            <button style={{ ...btn(local.fasting, true), ...(local.fasting ? { background: '#0e1e30', borderColor: C.blue, color: C.blue } : {}) }} onClick={toggleFasting}>
              {local.fasting ? '↩ Undo Fast' : '🚫 Fasting Day'}
            </button>
          </div>
        </div>

        {addOpen && (
          <div style={{ ...card({ background: '#0c0e16', marginBottom: 16 }) }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
              {[
                { k: 'name',    label: 'Food / Meal',  ph: 'Chicken breast 200g', type: 'text'   },
                { k: 'cals',    label: 'Calories',     ph: '330',                 type: 'number' },
                { k: 'protein', label: 'Protein (g)',  ph: '62',                  type: 'number' },
                { k: 'carbs',   label: 'Carbs (g)',    ph: '0',                   type: 'number' },
                { k: 'fat',     label: 'Fat (g)',      ph: '7',                   type: 'number' },
              ].map(({ k, label, ph, type }) => (
                <div key={k}>
                  <label style={LBL}>{label}</label>
                  <input style={inp()} type={type} value={mf[k]} placeholder={ph}
                    onChange={e => setMf(p => ({ ...p, [k]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={btn(true, true)} onClick={addMeal}>Add</button>
              <button style={btn(false, true)} onClick={() => setAddOpen(false)}>Cancel</button>
            </div>
          </div>
        )}

        {local.meals.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: C.textSub, fontSize: 14 }}>
            {local.fasting ? 'Fasting — no meals logged for today.' : 'No meals logged yet — add your first!'}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 32px', gap: 8, padding: '4px 10px', fontSize: 11, color: C.textSub, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              {['Food', 'Calories', 'Protein', 'Carbs', 'Fat', ''].map(h => <span key={h}>{h}</span>)}
            </div>
            {local.meals.map((m, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 32px', gap: 8, padding: '12px 10px', background: '#0c0e16', borderRadius: 8, marginBottom: 6, alignItems: 'center', fontSize: 14 }}>
                <span>{m.name}</span>
                <span style={{ fontFamily: F.mono, color: C.accent  }}>{m.cals}</span>
                <span style={{ fontFamily: F.mono, color: C.orange  }}>{m.protein}g</span>
                <span style={{ fontFamily: F.mono, color: C.blue    }}>{m.carbs}g</span>
                <span style={{ fontFamily: F.mono, color: C.textSub }}>{m.fat}g</span>
                <button onClick={() => removeMeal(i)} style={{ background: 'none', border: 'none', color: C.textSub, cursor: 'pointer', fontSize: 20, padding: 0, lineHeight: 1 }}
                  onMouseEnter={e => e.currentTarget.style.color = C.red}
                  onMouseLeave={e => e.currentTarget.style.color = C.textSub}>×</button>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 32px', gap: 8, padding: '10px 10px', borderTop: `1px solid ${C.border}`, marginTop: 4, fontSize: 13, fontWeight: 600 }}>
              <span style={{ color: C.textSub }}>Total</span>
              <span style={{ fontFamily: F.mono, color: C.accent  }}>{totalCals}</span>
              <span style={{ fontFamily: F.mono, color: C.orange  }}>{totalProtein}g</span>
              <span style={{ fontFamily: F.mono, color: C.blue    }}>{totalCarbs}g</span>
              <span style={{ fontFamily: F.mono, color: C.textSub }}>{totalFat}g</span>
              <span />
            </div>
          </>
        )}
      </div>

      {/* Notes */}
      <div style={{ ...card(), gridColumn: '1 / -1' }}>
        <label style={LBL}>Daily Notes</label>
        <textarea style={{ ...inp({ minHeight: 80, resize: 'vertical' }) }}
          value={local.notes || ''} placeholder="Energy levels? Training session? Hunger? Mood? Any observations..."
          onChange={e => upd('notes', e.target.value)} />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   NUTRITION TAB
═══════════════════════════════════════════════════════════════ */
function NutritionTab({ log, adaptiveTDEE, allLogs }) {
  const sum = fn => log.meals.reduce((s, m) => s + (fn(m) || 0), 0)
  const todayCals    = sum(m => +m.cals)
  const todayProtein = sum(m => +m.protein)
  const todayCarbs   = sum(m => +m.carbs)
  const todayFat     = sum(m => +m.fat)

  const r7 = allLogs.slice(-7)
  const avg7 = fn => r7.length ? Math.round(r7.reduce((s, l) => s + fn(l), 0) / r7.length) : 0
  const avgCals    = avg7(l => l.meals.reduce((s, m) => s + (+m.cals || 0), 0))
  const avgProtein = avg7(l => l.meals.reduce((s, m) => s + (+m.protein || 0), 0))

  const calHistory = allLogs.slice(-14).map(l => ({
    date: fmtDate(l.date),
    cals: l.meals.reduce((s, m) => s + (+m.cals || 0), 0),
  }))

  const proteinTarget = Math.round(adaptiveTDEE.curW * 2.2)
  const macros = [
    { name: 'Protein', g: todayProtein, cals: todayProtein * 4, color: C.orange },
    { name: 'Carbs',   g: todayCarbs,   cals: todayCarbs * 4,   color: C.blue   },
    { name: 'Fat',     g: todayFat,     cals: todayFat * 9,     color: C.purple },
  ]
  const totalCals = todayCals || 1

  return (
    <div style={{ padding: 20, maxWidth: 980, margin: '0 auto', display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: "Today's Calories", val: todayCals,           unit: 'kcal', color: C.accent },
          { label: 'Target',           val: adaptiveTDEE.target, unit: 'kcal', color: C.text   },
          { label: '7-Day Avg Cals',   val: avgCals,             unit: 'kcal', color: C.blue   },
          { label: '7-Day Avg Protein',val: avgProtein,          unit: 'g',    color: C.orange },
        ].map(({ label, val, unit, color }) => (
          <div key={label} style={card({ textAlign: 'center' })}>
            <div style={{ fontFamily: F.mono, fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>{val}<span style={{ fontSize: 13 }}> {unit}</span></div>
            <div style={{ fontSize: 11, color: C.textSub, marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
        <div style={card()}>
          <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 18 }}>Today's Macros</div>
          {macros.map(m => (
            <div key={m.name} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7, fontSize: 13 }}>
                <span style={{ color: C.textSub }}>{m.name}</span>
                <span style={{ fontFamily: F.mono, color: m.color }}>{m.g}g <span style={{ color: C.textSub, fontSize: 11 }}>({m.cals} kcal)</span></span>
              </div>
              <div style={{ height: 4, background: C.border, borderRadius: 2 }}>
                <div style={{ height: '100%', width: `${Math.min((m.cals / totalCals) * 100, 100)}%`, background: m.color, borderRadius: 2 }} />
              </div>
            </div>
          ))}
          <div style={{ paddingTop: 14, borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.textSub }}>
            Target: <strong style={{ color: C.orange }}>{proteinTarget}g protein</strong>
            <span style={{ marginLeft: 10, color: todayProtein >= proteinTarget ? C.accent : C.red }}>
              {todayProtein >= proteinTarget ? '✓ Hit' : `${proteinTarget - todayProtein}g short`}
            </span>
          </div>
        </div>
        <div style={card()}>
          <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 18 }}>14-Day Calorie History</div>
          {calHistory.length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={calHistory} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: C.textSub, fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: C.textSub, fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip {...TT} />
                <ReferenceLine y={adaptiveTDEE.target} stroke={C.red} strokeDasharray="4 4" />
                <Bar dataKey="cals" fill={C.accent} opacity={0.85} radius={[3, 3, 0, 0]} name="Calories" />
              </BarChart>
            </ResponsiveContainer>
          ) : <div style={{ padding: '60px 0', textAlign: 'center', color: C.textSub }}>Log meals for a few days to see history</div>}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   PROGRESS TAB
═══════════════════════════════════════════════════════════════ */
function ProgressTab({ logs, setup, inBodyScans, goalWeight }) {
  const latestWeight = logs.filter(l => l.weight != null).at(-1)?.weight ?? setup.startWeight
  const latestBF     = inBodyScans.at(-1)?.bf ?? setup.startBF
  const weightLost   = setup.startWeight - latestWeight

  const r7 = logs.slice(-7)
  const avgOf = fn => { const v = r7.filter(fn).map(fn); return v.length ? Math.round(v.reduce((s, x) => s + x) / v.length * 10) / 10 : null }
  const avgSleep = avgOf(l => l.sleep)
  const avgSteps = (() => { const v = r7.filter(l => l.steps).map(l => l.steps); return v.length ? Math.round(v.reduce((s, x) => s + x) / v.length) : null })()
  const avgDW    = avgOf(l => l.deepWork)

  const weightData = logs.filter(l => l.weight != null).map(l => ({ date: fmtDate(l.date), weight: l.weight, goal: Math.round(goalWeight * 10) / 10 }))
  const sleepData  = logs.filter(l => l.sleep  != null).map(l => ({ date: fmtDate(l.date), sleep: l.sleep   }))
  const stepsData  = logs.filter(l => l.steps  != null).map(l => ({ date: fmtDate(l.date), steps: l.steps   }))
  const dwData     = logs.filter(l => l.deepWork != null).map(l => ({ date: fmtDate(l.date), hours: l.deepWork }))

  return (
    <div style={{ padding: 20, maxWidth: 980, margin: '0 auto', display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Weight Lost',   val: weightLost >= 0 ? `-${weightLost.toFixed(1)}` : `+${Math.abs(weightLost).toFixed(1)}`, unit: 'kg',  color: weightLost >= 0 ? C.accent : C.red },
          { label: 'Current BF %', val: `${latestBF}`,                      unit: '%',   color: C.orange },
          { label: '7d Avg Sleep', val: avgSleep ?? '—',                     unit: avgSleep  ? 'hrs' : '', color: C.blue   },
          { label: '7d Avg Steps', val: avgSteps ? avgSteps.toLocaleString() : '—', unit: '', color: C.purple },
        ].map(({ label, val, unit, color }) => (
          <div key={label} style={card({ textAlign: 'center' })}>
            <div style={{ fontFamily: F.mono, fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>{val}<span style={{ fontSize: 13 }}> {unit}</span></div>
            <div style={{ fontSize: 11, color: C.textSub, marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={card()}>
        <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Weight Trend</div>
        {weightData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={weightData} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
              <defs>
                <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="10%" stopColor={C.accent} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={C.accent} stopOpacity={0}   />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: C.textSub, fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis domain={['auto', 'auto']} tick={{ fill: C.textSub, fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip {...TT} />
              <Area type="monotone" dataKey="weight" stroke={C.accent} fill="url(#wg)" strokeWidth={2.5} dot={{ fill: C.accent, r: 3, strokeWidth: 0 }} name="Weight (kg)" />
              <Line type="monotone" dataKey="goal" stroke={C.red} strokeDasharray="5 5" strokeWidth={1.5} dot={false} name="Goal" />
            </AreaChart>
          </ResponsiveContainer>
        ) : <div style={{ padding: '70px 0', textAlign: 'center', color: C.textSub }}>Log your weight each day in the Today tab</div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={card()}>
          <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Sleep (hrs)</div>
          {sleepData.length > 1 ? (
            <ResponsiveContainer width="100%" height={170}>
              <AreaChart data={sleepData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                <defs>
                  <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="10%" stopColor={C.blue} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={C.blue} stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: C.textSub, fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis domain={[4, 10]} tick={{ fill: C.textSub, fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip {...TT} />
                <ReferenceLine y={7} stroke={C.blue} strokeDasharray="4 4" opacity={0.5} />
                <Area type="monotone" dataKey="sleep" stroke={C.blue} fill="url(#sg)" strokeWidth={2} dot={{ fill: C.blue, r: 2, strokeWidth: 0 }} name="Sleep (hrs)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div style={{ padding: '50px 0', textAlign: 'center', color: C.textSub, fontSize: 13 }}>Log sleep in Today tab</div>}
        </div>

        <div style={card()}>
          <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Daily Steps</div>
          {stepsData.length > 1 ? (
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={stepsData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: C.textSub, fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: C.textSub, fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip {...TT} />
                <ReferenceLine y={10000} stroke={C.purple} strokeDasharray="4 4" />
                <Bar dataKey="steps" fill={C.purple} opacity={0.85} radius={[3, 3, 0, 0]} name="Steps" />
              </BarChart>
            </ResponsiveContainer>
          ) : <div style={{ padding: '50px 0', textAlign: 'center', color: C.textSub, fontSize: 13 }}>Log steps in Today tab</div>}
        </div>
      </div>

      {dwData.length > 1 && (
        <div style={card()}>
          <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Deep Work (hrs)</div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={dwData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: C.textSub, fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: C.textSub, fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip {...TT} />
              <ReferenceLine y={4} stroke={C.orange} strokeDasharray="4 4" />
              <Bar dataKey="hours" fill={C.orange} opacity={0.85} radius={[3, 3, 0, 0]} name="Hours" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={card()}>
        <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>7-Day Averages</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, textAlign: 'center' }}>
          {[
            { val: avgSleep,                                          target: 7,  unit: 'hrs',    label: 'Avg Sleep',     color: C.blue   },
            { val: avgSteps ? Math.round(avgSteps / 1000 * 10) / 10 : null, target: 10, unit: 'k steps', label: 'Avg Steps', color: C.purple },
            { val: avgDW,                                             target: 4,  unit: 'hrs',    label: 'Avg Deep Work', color: C.orange },
          ].map(({ val, target, unit, label, color }) => (
            <div key={label}>
              <div style={{ fontFamily: F.mono, fontSize: 26, color }}>{val ?? '—'}{val != null ? ` ${unit}` : ''}</div>
              <div style={{ fontSize: 12, color: C.textSub, marginTop: 4 }}>{label}</div>
              {val != null && (
                <div style={{ fontSize: 11, marginTop: 6, color: val >= target ? C.accent : C.orange }}>
                  {val >= target ? '✓ On track' : `Target: ${target} ${unit}`}
                </div>
              )}
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
  const [showAdd, setShowAdd] = useState(false)
  const [f, setF] = useState({ weight: '', bf: '', muscleMass: '', bmr: '', visceralFat: '', bmi: '' })
  const sf = (k, v) => setF(p => ({ ...p, [k]: v }))

  const addScan = () => {
    if (!f.weight || !f.bf) return
    onAdd({ date: todayStr(), weight: +f.weight, bf: +f.bf, muscleMass: f.muscleMass ? +f.muscleMass : null, bmr: f.bmr ? +f.bmr : null, visceralFat: f.visceralFat ? +f.visceralFat : null, bmi: f.bmi ? +f.bmi : null })
    setF({ weight: '', bf: '', muscleMass: '', bmr: '', visceralFat: '', bmi: '' }); setShowAdd(false)
  }

  const bfData = scans.map(s => ({ date: fmtDate(s.date), bf: s.bf, muscle: s.muscleMass }))

  return (
    <div style={{ padding: 20, maxWidth: 980, margin: '0 auto', display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontFamily: F.head, fontWeight: 800, fontSize: 20 }}>InBody Scans</div>
        <button style={btn(true, true)} onClick={() => setShowAdd(o => !o)}>+ Log Scan</button>
      </div>

      {showAdd && (
        <div style={card()}>
          <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>New Scan Entry</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 16 }}>
            {[
              { k: 'weight',      label: 'Body Weight (kg)',    ph: '74.0' },
              { k: 'bf',          label: 'Body Fat %',          ph: '20.0' },
              { k: 'muscleMass',  label: 'Skeletal Muscle (kg)', ph: '32.0' },
              { k: 'bmr',         label: 'BMR (kcal)',          ph: '1800'  },
              { k: 'visceralFat', label: 'Visceral Fat Level',  ph: '5'     },
              { k: 'bmi',         label: 'BMI',                 ph: '24.5'  },
            ].map(({ k, label, ph }) => (
              <div key={k}>
                <label style={LBL}>{label}</label>
                <input style={inp()} type="number" step="0.1" value={f[k]} placeholder={ph} onChange={e => sf(k, e.target.value)} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={btn(true, true)} onClick={addScan}>Save Scan</button>
            <button style={btn(false, true)} onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {bfData.length > 0 && (
        <div style={card()}>
          <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Body Fat % Trend</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={bfData} margin={{ top: 5, right: 30, bottom: 5, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: C.textSub, fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: C.textSub, fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip {...TT} />
              <ReferenceLine y={setup.goalBF} stroke={C.accent} strokeDasharray="5 5" label={{ value: `Goal ${setup.goalBF}%`, fill: C.accent, fontSize: 11, position: 'insideTopRight' }} />
              <Line type="monotone" dataKey="bf" stroke={C.orange} strokeWidth={2.5} dot={{ fill: C.orange, r: 4, strokeWidth: 0 }} name="Body Fat %" />
              {bfData[0]?.muscle != null && <Line type="monotone" dataKey="muscle" stroke={C.blue} strokeWidth={2} dot={{ fill: C.blue, r: 3, strokeWidth: 0 }} name="Muscle (kg)" />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {scans.length === 0 ? (
        <div style={card({ textAlign: 'center', padding: '64px 20px' })}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>🔬</div>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Log your first InBody scan</div>
          <div style={{ color: C.textSub, fontSize: 13 }}>Recommended every 2–3 weeks</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {[...scans].reverse().map((s, i) => {
            const prev = scans[scans.length - 2 - i]
            const bfDelta = prev ? Math.round((s.bf - prev.bf) * 10) / 10 : null
            return (
              <div key={i} style={card({ display: 'grid', gridTemplateColumns: 'auto repeat(6, 1fr)', gap: 16, alignItems: 'center' })}>
                <div style={{ fontFamily: F.mono, fontSize: 12, color: C.textSub, whiteSpace: 'nowrap' }}>{fmtDate(s.date)}</div>
                <div><div style={{ fontSize: 11, color: C.textSub }}>Weight</div><div style={{ fontFamily: F.mono, color: C.accent, marginTop: 3 }}>{s.weight}kg</div></div>
                <div>
                  <div style={{ fontSize: 11, color: C.textSub }}>Body Fat</div>
                  <div style={{ fontFamily: F.mono, color: C.orange, marginTop: 3 }}>
                    {s.bf}%
                    {bfDelta !== null && <span style={{ fontSize: 11, color: bfDelta < 0 ? C.accent : C.red, marginLeft: 6 }}>{bfDelta > 0 ? '+' : ''}{bfDelta}%</span>}
                  </div>
                </div>
                {s.muscleMass  && <div><div style={{ fontSize: 11, color: C.textSub }}>Muscle</div><div style={{ fontFamily: F.mono, color: C.blue,   marginTop: 3 }}>{s.muscleMass}kg</div></div>}
                {s.bmr         && <div><div style={{ fontSize: 11, color: C.textSub }}>BMR</div>   <div style={{ fontFamily: F.mono, marginTop: 3 }}>{s.bmr} kcal</div></div>}
                {s.visceralFat && <div><div style={{ fontSize: 11, color: C.textSub }}>Visceral</div><div style={{ fontFamily: F.mono, marginTop: 3 }}>Lvl {s.visceralFat}</div></div>}
                {s.bmi         && <div><div style={{ fontSize: 11, color: C.textSub }}>BMI</div>   <div style={{ fontFamily: F.mono, marginTop: 3 }}>{s.bmi}</div></div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   ROOT APP
═══════════════════════════════════════════════════════════════ */
export default function App() {
  const [session,    setSession]    = useState(undefined)  // undefined = loading, null = logged out
  const [tab,        setTab]        = useState('today')
  const [setup,      setSetup]      = useState(null)
  const [dataReady,  setDataReady]  = useState(false)
  const [onboarding, setOnboarding] = useState(false)
  const [todayLog,   setTodayLog]   = useState(null)
  const [allLogs,    setAllLogs]    = useState([])
  const [inBodyScans,setInBodyScans]= useState([])

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  const loadData = useCallback(async () => {
    setDataReady(false)
    const s = await store.get('setup')
    setSetup(s)
    if (s) {
      const td   = await store.get(`log:${todayStr()}`)
      setTodayLog(td || emptyLog())
      const keys = await store.list('log:')
      const logs = (await Promise.all(keys.map(k => store.get(k)))).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date))
      setAllLogs(logs)
      const scans = await store.get('inbody') || []
      setInBodyScans(scans)
    }
    setDataReady(true)
  }, [])

  useEffect(() => { if (session) loadData() }, [session, loadData])

  const emptyLog = () => ({ date: todayStr(), weight: null, sleep: null, sleepQuality: null, steps: null, deepWork: null, meals: [], notes: '', fasting: false })

  const saveSetup = async s => {
    await store.set('setup', s)
    setSetup(s); setOnboarding(false)
    if (!todayLog) { setTodayLog(emptyLog()); setAllLogs([]); setInBodyScans([]) }
  }

  const saveTodayLog = async log => {
    await store.set(`log:${todayStr()}`, log)
    setTodayLog(log)
    setAllLogs(prev => {
      const idx = prev.findIndex(l => l.date === todayStr())
      if (idx >= 0) return prev.map((l, i) => i === idx ? log : l)
      return [...prev, log].sort((a, b) => a.date.localeCompare(b.date))
    })
  }

  const saveInBody = async scan => {
    const updated = [...inBodyScans, scan].sort((a, b) => a.date.localeCompare(b.date))
    await store.set('inbody', updated); setInBodyScans(updated)
  }

  const adaptiveTDEE = useMemo(() => getAdaptiveTDEE(setup, allLogs), [setup, allLogs])

  // ── Render gates ──────────────────────────────────────────────
  if (session === undefined) return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.accent, fontFamily: F.mono }}>
      Loading…
    </div>
  )
  if (!session) return <AuthScreen />
  if (!dataReady) return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.accent, fontFamily: F.mono }}>
      Loading your data…
    </div>
  )
  if (!setup || onboarding) return (
    <Onboarding userEmail={session.user.email} onSave={saveSetup} existing={setup} onCancel={() => setOnboarding(false)} />
  )
  if (!todayLog) return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.accent, fontFamily: F.mono }}>
      Loading today…
    </div>
  )

  const latestWeight = allLogs.filter(l => l.weight != null).at(-1)?.weight ?? setup.startWeight
  const lbm          = setup.startWeight * (1 - setup.startBF / 100)
  const goalWeight   = lbm / (1 - setup.goalBF / 100)
  const dayCount     = daysBetween(setup.startDate, todayStr()) + 1
  const daysLeft     = Math.max(0, 60 - dayCount + 1)

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: F.body, color: C.text }}>
      <Header
        setup={setup} dayCount={dayCount} daysLeft={daysLeft}
        latestWeight={latestWeight} goalWeight={goalWeight}
        onSettings={() => setOnboarding(true)}
        onLogout={() => supabase.auth.signOut()}
      />
      <TabBar tab={tab} setTab={setTab} />
      {tab === 'today'     && <TodayTab     log={todayLog} adaptiveTDEE={adaptiveTDEE} onSave={saveTodayLog} />}
      {tab === 'nutrition' && <NutritionTab log={todayLog} adaptiveTDEE={adaptiveTDEE} allLogs={allLogs} />}
      {tab === 'progress'  && <ProgressTab  logs={allLogs} setup={setup} inBodyScans={inBodyScans} goalWeight={goalWeight} />}
      {tab === 'inbody'    && <InBodyTab    scans={inBodyScans} onAdd={saveInBody} setup={setup} />}
    </div>
  )
}
