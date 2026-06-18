import { useState, useEffect, useRef, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { C, F, SHADOW, GLOW, card, btn, inp, LBL, TT, useIsMobile, buzz } from './lib/theme'
import { Icon } from './lib/icons'
import { store } from './lib/store'

/* ═══════════════════════════════════════════════════════════════
   EXERCISE DATABASE
═══════════════════════════════════════════════════════════════ */
export const EXERCISE_DB = [
  // ── Chest ─────────────────────────────────────────────────────
  { id:'bench_press',       name:'Bench Press',                cat:'Chest',     eq:'Barbell'    },
  { id:'incline_bench',     name:'Incline Bench Press',        cat:'Chest',     eq:'Barbell'    },
  { id:'decline_bench',     name:'Decline Bench Press',        cat:'Chest',     eq:'Barbell'    },
  { id:'smith_bench',       name:'Smith Machine Bench',        cat:'Chest',     eq:'Machine'    },
  { id:'db_bench',          name:'DB Bench Press',             cat:'Chest',     eq:'Dumbbell'   },
  { id:'incline_db_bench',  name:'Incline DB Bench Press',     cat:'Chest',     eq:'Dumbbell'   },
  { id:'db_fly',            name:'Dumbbell Fly',               cat:'Chest',     eq:'Dumbbell'   },
  { id:'incline_db_fly',    name:'Incline Dumbbell Fly',       cat:'Chest',     eq:'Dumbbell'   },
  { id:'cable_fly',         name:'Cable Crossover',            cat:'Chest',     eq:'Cable'      },
  { id:'low_cable_fly',     name:'Low Cable Fly',              cat:'Chest',     eq:'Cable'      },
  { id:'pec_deck',          name:'Pec Deck',                   cat:'Chest',     eq:'Machine'    },
  { id:'chest_press_mach',  name:'Chest Press Machine',        cat:'Chest',     eq:'Machine'    },
  { id:'push_up',           name:'Push Up',                    cat:'Chest',     eq:'Bodyweight' },
  { id:'incline_push_up',   name:'Incline Push Up',            cat:'Chest',     eq:'Bodyweight' },
  { id:'diamond_push_up',   name:'Diamond Push Up',            cat:'Chest',     eq:'Bodyweight' },
  { id:'chest_dip',         name:'Chest Dip',                  cat:'Chest',     eq:'Bodyweight' },
  { id:'landmine_press',    name:'Landmine Press',             cat:'Chest',     eq:'Barbell'    },
  { id:'svend_press',       name:'Svend Press',                cat:'Chest',     eq:'Other'      },
  // ── Back ──────────────────────────────────────────────────────
  { id:'deadlift',          name:'Deadlift',                   cat:'Back',      eq:'Barbell'    },
  { id:'sumo_deadlift',     name:'Sumo Deadlift',              cat:'Back',      eq:'Barbell'    },
  { id:'rack_pull',         name:'Rack Pull',                  cat:'Back',      eq:'Barbell'    },
  { id:'barbell_row',       name:'Barbell Row',                cat:'Back',      eq:'Barbell'    },
  { id:'pendlay_row',       name:'Pendlay Row',                cat:'Back',      eq:'Barbell'    },
  { id:'meadows_row',       name:'Meadows Row',                cat:'Back',      eq:'Barbell'    },
  { id:'tbar_row',          name:'T-Bar Row',                  cat:'Back',      eq:'Barbell'    },
  { id:'pull_up',           name:'Pull Up',                    cat:'Back',      eq:'Bodyweight' },
  { id:'chin_up',           name:'Chin Up',                    cat:'Back',      eq:'Bodyweight' },
  { id:'neutral_pull_up',   name:'Neutral Grip Pull Up',       cat:'Back',      eq:'Bodyweight' },
  { id:'lat_pulldown',      name:'Lat Pulldown',               cat:'Back',      eq:'Cable'      },
  { id:'close_lat_pull',    name:'Close Grip Lat Pulldown',    cat:'Back',      eq:'Cable'      },
  { id:'cable_row',         name:'Seated Cable Row',           cat:'Back',      eq:'Cable'      },
  { id:'single_cable_row',  name:'Single Arm Cable Row',       cat:'Back',      eq:'Cable'      },
  { id:'straight_pulldown', name:'Straight Arm Pulldown',      cat:'Back',      eq:'Cable'      },
  { id:'db_row',            name:'Dumbbell Row',               cat:'Back',      eq:'Dumbbell'   },
  { id:'chest_sup_row',     name:'Chest Supported Row',        cat:'Back',      eq:'Dumbbell'   },
  { id:'machine_row',       name:'Machine Row',                cat:'Back',      eq:'Machine'    },
  { id:'back_extension',    name:'Back Extension',             cat:'Back',      eq:'Bodyweight' },
  { id:'good_morning',      name:'Good Morning',               cat:'Back',      eq:'Barbell'    },
  { id:'barbell_shrug',     name:'Barbell Shrug',              cat:'Back',      eq:'Barbell'    },
  { id:'db_shrug',          name:'Dumbbell Shrug',             cat:'Back',      eq:'Dumbbell'   },
  // ── Shoulders ─────────────────────────────────────────────────
  { id:'ohp',               name:'Overhead Press',             cat:'Shoulders', eq:'Barbell'    },
  { id:'push_press',        name:'Push Press',                 cat:'Shoulders', eq:'Barbell'    },
  { id:'db_ohp',            name:'DB Shoulder Press',          cat:'Shoulders', eq:'Dumbbell'   },
  { id:'arnold_press',      name:'Arnold Press',               cat:'Shoulders', eq:'Dumbbell'   },
  { id:'machine_ohp',       name:'Machine Shoulder Press',     cat:'Shoulders', eq:'Machine'    },
  { id:'smith_ohp',         name:'Smith Machine OHP',          cat:'Shoulders', eq:'Machine'    },
  { id:'lateral_raise',     name:'Lateral Raise',              cat:'Shoulders', eq:'Dumbbell'   },
  { id:'cable_lateral',     name:'Cable Lateral Raise',        cat:'Shoulders', eq:'Cable'      },
  { id:'machine_lateral',   name:'Machine Lateral Raise',      cat:'Shoulders', eq:'Machine'    },
  { id:'front_raise',       name:'Front Raise',                cat:'Shoulders', eq:'Dumbbell'   },
  { id:'plate_front_raise', name:'Plate Front Raise',          cat:'Shoulders', eq:'Other'      },
  { id:'face_pull',         name:'Face Pull',                  cat:'Shoulders', eq:'Cable'      },
  { id:'rear_delt_fly',     name:'Rear Delt Fly',              cat:'Shoulders', eq:'Dumbbell'   },
  { id:'reverse_pec_deck',  name:'Reverse Pec Deck',           cat:'Shoulders', eq:'Machine'    },
  { id:'upright_row',       name:'Upright Row',                cat:'Shoulders', eq:'Barbell'    },
  { id:'lu_raise',          name:'Lu Raise',                   cat:'Shoulders', eq:'Dumbbell'   },
  // ── Biceps ────────────────────────────────────────────────────
  { id:'barbell_curl',      name:'Barbell Curl',               cat:'Biceps',    eq:'Barbell'    },
  { id:'ez_bar_curl',       name:'EZ Bar Curl',                cat:'Biceps',    eq:'Barbell'    },
  { id:'db_curl',           name:'Dumbbell Curl',              cat:'Biceps',    eq:'Dumbbell'   },
  { id:'hammer_curl',       name:'Hammer Curl',                cat:'Biceps',    eq:'Dumbbell'   },
  { id:'incline_db_curl',   name:'Incline DB Curl',            cat:'Biceps',    eq:'Dumbbell'   },
  { id:'concentration_curl',name:'Concentration Curl',         cat:'Biceps',    eq:'Dumbbell'   },
  { id:'spider_curl',       name:'Spider Curl',                cat:'Biceps',    eq:'Dumbbell'   },
  { id:'cross_body_curl',   name:'Cross Body Curl',            cat:'Biceps',    eq:'Dumbbell'   },
  { id:'preacher_curl',     name:'Preacher Curl',              cat:'Biceps',    eq:'Barbell'    },
  { id:'machine_curl',      name:'Machine Curl',               cat:'Biceps',    eq:'Machine'    },
  { id:'cable_curl',        name:'Cable Curl',                 cat:'Biceps',    eq:'Cable'      },
  { id:'cable_hammer_curl', name:'Cable Hammer Curl',          cat:'Biceps',    eq:'Cable'      },
  { id:'reverse_curl',      name:'Reverse Curl',               cat:'Biceps',    eq:'Barbell'    },
  // ── Triceps ───────────────────────────────────────────────────
  { id:'tricep_pushdown',   name:'Tricep Pushdown',            cat:'Triceps',   eq:'Cable'      },
  { id:'rope_pushdown',     name:'Rope Pushdown',              cat:'Triceps',   eq:'Cable'      },
  { id:'single_pushdown',   name:'Single Arm Pushdown',        cat:'Triceps',   eq:'Cable'      },
  { id:'skull_crusher',     name:'Skull Crusher',              cat:'Triceps',   eq:'Barbell'    },
  { id:'ez_skull_crusher',  name:'EZ Bar Skull Crusher',       cat:'Triceps',   eq:'Barbell'    },
  { id:'overhead_ext',      name:'Overhead Tricep Ext',        cat:'Triceps',   eq:'Dumbbell'   },
  { id:'cable_overhead_ext',name:'Cable Overhead Extension',   cat:'Triceps',   eq:'Cable'      },
  { id:'close_grip_bench',  name:'Close Grip Bench',           cat:'Triceps',   eq:'Barbell'    },
  { id:'jm_press',          name:'JM Press',                   cat:'Triceps',   eq:'Barbell'    },
  { id:'tricep_dip',        name:'Tricep Dip',                 cat:'Triceps',   eq:'Bodyweight' },
  { id:'diamond_push_up_t', name:'Diamond Push Up',            cat:'Triceps',   eq:'Bodyweight' },
  { id:'kickback',          name:'Tricep Kickback',            cat:'Triceps',   eq:'Dumbbell'   },
  // ── Legs ──────────────────────────────────────────────────────
  { id:'squat',             name:'Back Squat',                 cat:'Legs',      eq:'Barbell'    },
  { id:'front_squat',       name:'Front Squat',                cat:'Legs',      eq:'Barbell'    },
  { id:'low_bar_squat',     name:'Low Bar Squat',              cat:'Legs',      eq:'Barbell'    },
  { id:'smith_squat',       name:'Smith Machine Squat',        cat:'Legs',      eq:'Machine'    },
  { id:'hack_squat',        name:'Hack Squat',                 cat:'Legs',      eq:'Machine'    },
  { id:'leg_press',         name:'Leg Press',                  cat:'Legs',      eq:'Machine'    },
  { id:'rdl',               name:'Romanian Deadlift',          cat:'Legs',      eq:'Barbell'    },
  { id:'db_rdl',            name:'DB Romanian Deadlift',       cat:'Legs',      eq:'Dumbbell'   },
  { id:'stiff_leg_dl',      name:'Stiff Leg Deadlift',         cat:'Legs',      eq:'Barbell'    },
  { id:'leg_curl',          name:'Lying Leg Curl',             cat:'Legs',      eq:'Machine'    },
  { id:'seated_leg_curl',   name:'Seated Leg Curl',            cat:'Legs',      eq:'Machine'    },
  { id:'nordic_curl',       name:'Nordic Hamstring Curl',      cat:'Legs',      eq:'Bodyweight' },
  { id:'leg_extension',     name:'Leg Extension',              cat:'Legs',      eq:'Machine'    },
  { id:'hip_thrust',        name:'Hip Thrust',                 cat:'Legs',      eq:'Barbell'    },
  { id:'db_hip_thrust',     name:'DB Hip Thrust',              cat:'Legs',      eq:'Dumbbell'   },
  { id:'glute_bridge',      name:'Glute Bridge',               cat:'Legs',      eq:'Bodyweight' },
  { id:'cable_kickback',    name:'Cable Glute Kickback',       cat:'Legs',      eq:'Cable'      },
  { id:'lunges',            name:'Lunges',                     cat:'Legs',      eq:'Bodyweight' },
  { id:'db_lunges',         name:'DB Lunges',                  cat:'Legs',      eq:'Dumbbell'   },
  { id:'reverse_lunge',     name:'Reverse Lunge',              cat:'Legs',      eq:'Bodyweight' },
  { id:'bulgarian_ss',      name:'Bulgarian Split Squat',      cat:'Legs',      eq:'Dumbbell'   },
  { id:'step_up',           name:'Step Up',                    cat:'Legs',      eq:'Dumbbell'   },
  { id:'goblet_squat',      name:'Goblet Squat',               cat:'Legs',      eq:'Dumbbell'   },
  { id:'sissy_squat',       name:'Sissy Squat',                cat:'Legs',      eq:'Bodyweight' },
  { id:'wall_sit',          name:'Wall Sit',                   cat:'Legs',      eq:'Bodyweight' },
  { id:'calf_raise',        name:'Standing Calf Raise',        cat:'Legs',      eq:'Machine'    },
  { id:'seated_calf_raise', name:'Seated Calf Raise',          cat:'Legs',      eq:'Machine'    },
  { id:'db_calf_raise',     name:'DB Single Leg Calf Raise',   cat:'Legs',      eq:'Dumbbell'   },
  // ── Core ──────────────────────────────────────────────────────
  { id:'plank',             name:'Plank',                      cat:'Core',      eq:'Bodyweight' },
  { id:'side_plank',        name:'Side Plank',                 cat:'Core',      eq:'Bodyweight' },
  { id:'crunches',          name:'Crunches',                   cat:'Core',      eq:'Bodyweight' },
  { id:'decline_crunch',    name:'Decline Crunch',             cat:'Core',      eq:'Bodyweight' },
  { id:'leg_raise',         name:'Hanging Leg Raise',          cat:'Core',      eq:'Bodyweight' },
  { id:'knee_raise',        name:'Hanging Knee Raise',         cat:'Core',      eq:'Bodyweight' },
  { id:'lying_leg_raise',   name:'Lying Leg Raise',            cat:'Core',      eq:'Bodyweight' },
  { id:'ab_wheel',          name:'Ab Wheel',                   cat:'Core',      eq:'Other'      },
  { id:'cable_crunch',      name:'Cable Crunch',               cat:'Core',      eq:'Cable'      },
  { id:'russian_twist',     name:'Russian Twist',              cat:'Core',      eq:'Bodyweight' },
  { id:'weighted_rus_twist',name:'Weighted Russian Twist',     cat:'Core',      eq:'Other'      },
  { id:'dead_bug',          name:'Dead Bug',                   cat:'Core',      eq:'Bodyweight' },
  { id:'bird_dog',          name:'Bird Dog',                   cat:'Core',      eq:'Bodyweight' },
  { id:'hollow_hold',       name:'Hollow Body Hold',           cat:'Core',      eq:'Bodyweight' },
  { id:'dragon_flag',       name:'Dragon Flag',                cat:'Core',      eq:'Bodyweight' },
  { id:'pallof_press',      name:'Pallof Press',               cat:'Core',      eq:'Cable'      },
  { id:'woodchop',          name:'Cable Woodchop',             cat:'Core',      eq:'Cable'      },
  { id:'sit_up',            name:'Sit Up',                     cat:'Core',      eq:'Bodyweight' },
  { id:'v_up',              name:'V-Up',                       cat:'Core',      eq:'Bodyweight' },
  // ── Olympic / Power ───────────────────────────────────────────
  { id:'power_clean',       name:'Power Clean',                cat:'Olympic',   eq:'Barbell'    },
  { id:'hang_clean',        name:'Hang Clean',                 cat:'Olympic',   eq:'Barbell'    },
  { id:'clean_and_jerk',    name:'Clean and Jerk',             cat:'Olympic',   eq:'Barbell'    },
  { id:'snatch',            name:'Snatch',                     cat:'Olympic',   eq:'Barbell'    },
  { id:'hang_snatch',       name:'Hang Snatch',                cat:'Olympic',   eq:'Barbell'    },
  { id:'thruster',          name:'Thruster',                   cat:'Olympic',   eq:'Barbell'    },
  { id:'db_thruster',       name:'DB Thruster',                cat:'Olympic',   eq:'Dumbbell'   },
  { id:'kettlebell_swing',  name:'Kettlebell Swing',           cat:'Olympic',   eq:'Other'      },
  { id:'clean_pull',        name:'Clean Pull',                 cat:'Olympic',   eq:'Barbell'    },
  // ── Cardio ────────────────────────────────────────────────────
  { id:'treadmill',         name:'Treadmill Run',              cat:'Cardio',    eq:'Machine'    },
  { id:'rowing_machine',    name:'Rowing Machine',             cat:'Cardio',    eq:'Machine'    },
  { id:'assault_bike',      name:'Assault Bike',               cat:'Cardio',    eq:'Machine'    },
  { id:'stairmaster',       name:'Stairmaster',                cat:'Cardio',    eq:'Machine'    },
  { id:'stationary_bike',   name:'Stationary Bike',            cat:'Cardio',    eq:'Machine'    },
  { id:'jump_rope',         name:'Jump Rope',                  cat:'Cardio',    eq:'Other'      },
  { id:'burpees',           name:'Burpees',                    cat:'Cardio',    eq:'Bodyweight' },
  { id:'mountain_climber',  name:'Mountain Climbers',          cat:'Cardio',    eq:'Bodyweight' },
  { id:'jump_squat',        name:'Jump Squat',                 cat:'Cardio',    eq:'Bodyweight' },
  { id:'box_jump',          name:'Box Jump',                   cat:'Cardio',    eq:'Other'      },
  // ── Forearms ──────────────────────────────────────────────────
  { id:'wrist_curl',        name:'Wrist Curl',                 cat:'Forearms',  eq:'Barbell'    },
  { id:'reverse_wrist_curl',name:'Reverse Wrist Curl',         cat:'Forearms',  eq:'Barbell'    },
  { id:'farmers_walk',      name:'Farmers Walk',               cat:'Forearms',  eq:'Dumbbell'   },
  { id:'dead_hang',         name:'Dead Hang',                  cat:'Forearms',  eq:'Bodyweight' },
  { id:'plate_pinch',       name:'Plate Pinch',                cat:'Forearms',  eq:'Other'      },
]

const CAT_COLORS = {
  Chest:'#f0566f', Back:'#6aa9f5', Shoulders:'#a78bfa',
  Biceps:'#f0964d', Triceps:'#f0964d', Legs:'#4dd4c0', Core:'#85858f',
  Olympic:'#e0b94d', Cardio:'#4dd4c0', Forearms:'#85858f'
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════ */
const genId   = () => `${Date.now()}_${Math.random().toString(36).slice(2,6)}`
const fmtSec  = s  => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`
const fmtDur  = s  => { const m=Math.floor(s/60); const h=Math.floor(m/60); return h>0?`${h}h ${m%60}m`:`${m}m` }
const calc1RM = (w,r) => r===1 ? +w : Math.round(+w*(1+(+r)/30)*10)/10
// LOCAL date — toISOString() is UTC and stamps late-night workouts on yesterday (IST)
const todayStr= () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const fmtDate = d  => new Date(d+'T12:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})

function getPrevSets(history, exerciseId) {
  const sorted = [...history].sort((a,b)=>b.date.localeCompare(a.date))
  for (const w of sorted) {
    const ex = w.exercises?.find(e=>e.exerciseId===exerciseId)
    if (ex?.sets?.length) return ex.sets
  }
  return null
}

function getBest1RM(history, exerciseId) {
  let best = 0
  for (const w of history) {
    const ex = w.exercises?.find(e=>e.exerciseId===exerciseId)
    if (ex) for (const s of (ex.sets||[])) {
      if (s.done&&s.weight&&s.reps) best = Math.max(best, calc1RM(+s.weight,+s.reps))
    }
  }
  return best
}

function calcVolume(exercises) {
  return exercises.reduce((t,ex)=>
    t+(ex.sets||[]).filter(s=>s.done&&s.weight&&s.reps).reduce((s,st)=>(+st.weight)*(+st.reps)+s,0),0)
}

/* design tokens come from the shared theme (lib/theme.js) */

/* ═══════════════════════════════════════════════════════════════
   REST TIMER OVERLAY
═══════════════════════════════════════════════════════════════ */
function RestTimer({ seconds, onDismiss }) {
  // Wall-clock based: mobile browsers (Brave/Android especially) throttle or
  // suspend timers when the screen locks — a tick-counting timer stalls.
  const [endAt, setEndAt] = useState(()=>Date.now()+seconds*1000)
  const [now,   setNow]   = useState(()=>Date.now())
  useEffect(()=>{
    const t=setInterval(()=>setNow(Date.now()),500)
    return ()=>clearInterval(t)
  },[])
  const rem = Math.max(0, Math.round((endAt-now)/1000))
  useEffect(()=>{ if (rem<=0) onDismiss() },[rem])
  const pct = Math.max(0, Math.min(100, ((seconds - rem)/seconds)*100))
  return (
    <div style={{ position:'fixed', bottom:'calc(86px + env(safe-area-inset-bottom, 0px))', right:16, zIndex:1000, background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, padding:'16px 20px', minWidth:170, boxShadow:'0 8px 32px #0008', animation:'fadeUp 0.2s ease' }}>
      <div style={{ fontSize:11, color:C.textSub, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:8 }}>Rest Timer</div>
      <div style={{ fontFamily:F.mono, fontSize:34, fontWeight:700, color:rem<=10?C.red:C.accent, textAlign:'center', marginBottom:8 }}>{fmtSec(rem)}</div>
      <div style={{ height:4, background:C.border, borderRadius:2, marginBottom:10 }}>
        <div style={{ height:'100%', width:`${pct}%`, background:C.accent, borderRadius:2, transition:'width 1s linear' }}/>
      </div>
      <div style={{ display:'flex', gap:6 }}>
        <button style={{ ...btn(false,true), flex:1, fontSize:12 }} onClick={()=>setEndAt(e=>e+30000)}>+30s</button>
        <button style={{ ...btn(true,true),  flex:1, fontSize:12 }} onClick={onDismiss}>Skip</button>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   EXERCISE SELECTOR  (bottom-sheet modal)
═══════════════════════════════════════════════════════════════ */
function ExerciseSelector({ onSelect, onClose, customExercises=[] }) {
  const [search, setSearch] = useState('')
  const [cat,    setCat]    = useState('All')
  const allEx  = [...EXERCISE_DB, ...customExercises]
  const cats   = ['All',...new Set(allEx.map(e=>e.cat))]
  const list   = allEx.filter(e=>(cat==='All'||e.cat===cat)&&e.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ position:'fixed', inset:0, background:'#000b', zIndex:500, display:'flex', alignItems:'flex-end' }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:C.bg, width:'100%', maxHeight:'88vh', borderRadius:'16px 16px 0 0', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {/* Header */}
        <div style={{ padding:'16px 18px', borderBottom:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div style={{ fontFamily:F.head, fontWeight:700, fontSize:16 }}>Select Exercise</div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.textSub, cursor:'pointer', fontSize:24, lineHeight:1, padding:'0 4px' }}>×</button>
        </div>
        {/* Search + filter */}
        <div style={{ padding:'12px 18px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
          <input style={{ ...inp(), width:'100%', boxSizing:'border-box', marginBottom:10, fontSize:15 }}
            placeholder="Search exercises…" value={search} onChange={e=>setSearch(e.target.value)} autoFocus />
          <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:2 }}>
            {cats.map(c=>(
              <button key={c} style={{ ...btn(cat===c,true), whiteSpace:'nowrap', flexShrink:0, fontSize:12 }} onClick={()=>setCat(c)}>{c}</button>
            ))}
          </div>
        </div>
        {/* List */}
        <div style={{ overflowY:'auto', flex:1 }}>
          {list.map(ex=>(
            <button key={ex.id} onClick={()=>onSelect(ex)}
              style={{ display:'flex', alignItems:'center', gap:12, width:'100%', padding:'13px 18px', background:'none', border:'none', borderBottom:`1px solid ${C.border}22`, cursor:'pointer', textAlign:'left', transition:'background 0.1s', fontFamily:F.body }}
              onMouseEnter={e=>e.currentTarget.style.background=C.surface}
              onMouseLeave={e=>e.currentTarget.style.background='none'}>
              <div style={{ width:38, height:38, borderRadius:8, background:(CAT_COLORS[ex.cat]||C.textSub)+'22', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <span style={{ fontSize:10, color:CAT_COLORS[ex.cat]||C.textSub, fontWeight:700 }}>{ex.cat.slice(0,3).toUpperCase()}</span>
              </div>
              <div>
                <div style={{ fontSize:14, color:C.text, fontWeight:500 }}>{ex.name}</div>
                <div style={{ fontSize:11, color:C.textSub, marginTop:2 }}>{ex.cat} · {ex.eq}</div>
              </div>
            </button>
          ))}
          {list.length===0 && <div style={{ textAlign:'center', padding:'40px 20px', color:C.textSub }}>No exercises found</div>}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   ROUTINE EDITOR
═══════════════════════════════════════════════════════════════ */
function RoutineEditor({ routine, onSave, onCancel }) {
  const [name,      setName]      = useState(routine?.name||'')
  const [exercises, setExercises] = useState(routine?.exercises||[])
  const [picker,    setPicker]    = useState(false)

  const addEx   = ex  => { setExercises(p=>[...p,{ exerciseId:ex.id, name:ex.name, cat:ex.cat, sets:3, repsTarget:8, restSeconds:90 }]); setPicker(false) }
  const removeEx= i   => setExercises(p=>p.filter((_,idx)=>idx!==i))
  const updEx   = (i,k,v) => setExercises(p=>p.map((ex,idx)=>idx===i?{...ex,[k]:v}:ex))
  const moveUp  = i   => { if(i===0)return; const a=[...exercises]; [a[i-1],a[i]]=[a[i],a[i-1]]; setExercises(a) }
  const moveDown= i   => { if(i===exercises.length-1)return; const a=[...exercises]; [a[i],a[i+1]]=[a[i+1],a[i]]; setExercises(a) }

  const canSave = name.trim() && exercises.length > 0

  return (
    <div style={{ padding:'16px', maxWidth:700, margin:'0 auto', paddingBottom:40 }}>
      {/* Header */}
      <div style={{ display:'flex', gap:10, marginBottom:20, alignItems:'center' }}>
        <button onClick={onCancel} style={{ background:'none', border:'none', color:C.textSub, cursor:'pointer', fontSize:22, padding:'4px 8px', lineHeight:1 }}>←</button>
        <div style={{ fontFamily:F.head, fontWeight:800, fontSize:20 }}>{routine?'Edit Routine':'New Routine'}</div>
      </div>

      <div style={{ marginBottom:20 }}>
        <label style={LBL}>Routine Name</label>
        <input style={{ ...inp(), width:'100%', boxSizing:'border-box', fontSize:16 }}
          value={name} placeholder="e.g. Push Day A, Pull Day, Leg Day…" onChange={e=>setName(e.target.value)} />
      </div>

      {exercises.map((ex,i)=>(
        <div key={i} style={{ ...card({ marginBottom:10 }) }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
            <div>
              <span style={{ display:'inline-block', padding:'2px 8px', background:(CAT_COLORS[ex.cat]||C.textSub)+'22', color:CAT_COLORS[ex.cat]||C.textSub, borderRadius:20, fontSize:10, fontWeight:700, marginBottom:5 }}>{ex.cat}</span>
              <div style={{ fontWeight:600, fontSize:15, color:C.text }}>{ex.name}</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:2 }}>
              <button onClick={()=>moveUp(i)}   style={{ background:'none', border:'none', color:i===0?C.border:C.textSub, cursor:i===0?'default':'pointer', fontSize:14, padding:'4px 6px' }}>▲</button>
              <button onClick={()=>moveDown(i)} style={{ background:'none', border:'none', color:i===exercises.length-1?C.border:C.textSub, cursor:i===exercises.length-1?'default':'pointer', fontSize:14, padding:'4px 6px' }}>▼</button>
              <button onClick={()=>removeEx(i)} style={{ background:'none', border:'none', color:C.textSub, cursor:'pointer', fontSize:20, padding:'4px 6px' }}
                onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.textSub}>×</button>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
            <div><label style={LBL}>Sets</label>
              <input style={inp({ textAlign:'center' })} type="number" inputMode="decimal" min="1" value={ex.sets} onChange={e=>updEx(i,'sets',+e.target.value)} /></div>
            <div><label style={LBL}>Reps Target</label>
              <input style={inp({ textAlign:'center' })} type="number" inputMode="decimal" min="1" value={ex.repsTarget} onChange={e=>updEx(i,'repsTarget',+e.target.value)} /></div>
            <div><label style={LBL}>Rest (sec)</label>
              <input style={inp({ textAlign:'center' })} type="number" inputMode="decimal" step="15" value={ex.restSeconds} onChange={e=>updEx(i,'restSeconds',+e.target.value)} /></div>
          </div>
        </div>
      ))}

      <button style={{ ...btn(false,true), width:'100%', marginBottom:14, borderStyle:'dashed', fontSize:14 }} onClick={()=>setPicker(true)}>
        + Add Exercise
      </button>

      <button style={{ ...btn(canSave), width:'100%', fontSize:15, padding:'13px 0', opacity:canSave?1:0.4 }}
        onClick={()=>canSave&&onSave({ id:routine?.id||genId(), name:name.trim(), exercises })}>
        {routine?'✓ Save Changes':'✓ Create Routine'}
      </button>

      {picker && <ExerciseSelector onSelect={addEx} onClose={()=>setPicker(false)} />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   ACTIVE WORKOUT
═══════════════════════════════════════════════════════════════ */
function ActiveWorkout({ workout, workoutHistory, onFinish, onCancel }) {
  const mobile = useIsMobile()

  const [exercises, setExercises] = useState(()=>
    workout.exercises.map(ex=>({
      ...ex,
      sets: Array.from({ length: ex.setsCount||ex.sets||3 }, (_,i)=>({
        id:genId(), setNum:i+1, weight:'', reps:'', done:false, isPR:false
      }))
    }))
  )
  const [restTimer,  setRestTimer]  = useState(null)
  const [picker,     setPicker]     = useState(false)
  const [notes,      setNotes]      = useState('')
  const [elapsed,    setElapsed]    = useState(0)
  const startTime = useRef(new Date().toISOString())
  const startMs   = useRef(Date.now())

  // wall-clock elapsed — tick-counting intervals stall when the phone locks
  useEffect(()=>{ const t=setInterval(()=>setElapsed(Math.floor((Date.now()-startMs.current)/1000)),1000); return()=>clearInterval(t) },[])

  // keyed on the exercise list so exercises added mid-workout get their history
  const exIdKey = exercises.map(e=>e.exerciseId).join(',')
  const prevSetsMap = useMemo(()=>{
    const m={}; exercises.forEach(ex=>{ m[ex.exerciseId]=getPrevSets(workoutHistory,ex.exerciseId) }); return m
  },[exIdKey, workoutHistory])  // eslint-disable-line react-hooks/exhaustive-deps

  const updSet = (ei,si,k,v) => setExercises(p=>p.map((ex,i)=>i!==ei?ex:{...ex,sets:ex.sets.map((s,j)=>j!==si?s:{...s,[k]:v})}))

  const toggleDone = (ei,si) => {
    const set  = exercises[ei].sets[si]
    const now  = !set.done
    let isPR   = false
    if (now && set.weight && set.reps) {
      const rm = calc1RM(+set.weight,+set.reps)
      // PR = beats history AND every set already done this session
      const histBest = getBest1RM(workoutHistory, exercises[ei].exerciseId)
      const sessionBest = exercises[ei].sets.reduce((b,s,j)=>
        j!==si && s.done && s.weight && s.reps ? Math.max(b, calc1RM(+s.weight,+s.reps)) : b, 0)
      if (rm > Math.max(histBest, sessionBest)) isPR = true
      buzz(isPR ? [30, 50, 90] : 15)
      setRestTimer({ seconds: exercises[ei].restSeconds||90, key: Date.now() })
    }
    setExercises(p=>p.map((ex,i)=>i!==ei?ex:{
      ...ex, sets:ex.sets.map((s,j)=>j!==si?s:{...s,done:now,isPR:now?isPR:false})
    }))
  }

  const addSet    = ei => setExercises(p=>p.map((ex,i)=>i!==ei?ex:{...ex,sets:[...ex.sets,{id:genId(),setNum:ex.sets.length+1,weight:'',reps:'',done:false,isPR:false}]}))
  const removeSet = (ei,si) => setExercises(p=>p.map((ex,i)=>i!==ei?ex:{...ex,sets:ex.sets.filter((_,j)=>j!==si).map((s,j)=>({...s,setNum:j+1}))}))
  const removeEx  = ei => setExercises(p=>p.filter((_,i)=>i!==ei))
  const addEx     = ex => { setExercises(p=>[...p,{exerciseId:ex.id,name:ex.name,cat:ex.cat,restSeconds:90,repsTarget:8,sets:[{id:genId(),setNum:1,weight:'',reps:'',done:false,isPR:false}]}]); setPicker(false) }

  const doneCount = exercises.reduce((s,ex)=>s+ex.sets.filter(st=>st.done).length,0)
  const totalSets = exercises.reduce((s,ex)=>s+ex.sets.length,0)
  const volume    = calcVolume(exercises)
  const hasPR     = exercises.some(ex=>ex.sets.some(s=>s.isPR))

  const finish = () => onFinish({
    id:genId(), date:todayStr(), startTime:startTime.current,
    endTime:new Date().toISOString(), duration:elapsed,
    routineId:workout.routineId, routineName:workout.routineName||'Quick Workout',
    notes,
    exercises:exercises.map(ex=>({ exerciseId:ex.exerciseId, name:ex.name, cat:ex.cat, sets:ex.sets.filter(s=>s.done) }))
  })

  return (
    <div style={{ background:C.bg, minHeight:'100vh', paddingBottom:100 }}>
      {/* Sticky header */}
      <div style={{ position:'sticky', top:0, zIndex:10, background:C.bg, borderBottom:`1px solid ${C.border}`, padding:'10px 14px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
          <div>
            <div style={{ fontFamily:F.head, fontWeight:700, fontSize:15 }}>{workout.routineName||'Quick Workout'}</div>
            <div style={{ fontFamily:F.mono, fontSize:11, color:C.textSub, marginTop:2 }}>
              {fmtDur(elapsed)} &nbsp;·&nbsp; {doneCount}/{totalSets} sets &nbsp;·&nbsp; {volume.toLocaleString()} kg
              {hasPR&&<span style={{ display:'inline-flex', alignItems:'center', gap:4, marginLeft:8, color:C.gold }}><Icon name="trophy" size={12} color={C.gold} /> PR!</span>}
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button style={{ ...btn(false,true), color:C.red, fontSize:12 }} onClick={()=>{ if(confirm('Discard this workout?')) onCancel() }}>Discard</button>
            <button style={{ ...btn(true,true), fontSize:12 }} onClick={finish}>Finish</button>
          </div>
        </div>
        <div style={{ height:3, background:C.border, borderRadius:2 }}>
          <div style={{ height:'100%', width:totalSets?`${(doneCount/totalSets)*100}%`:'0%', background:C.accent, borderRadius:2, transition:'width 0.3s' }}/>
        </div>
      </div>

      <div style={{ padding:'12px 14px' }}>
        {exercises.map((ex,ei)=>{
          const prev  = prevSetsMap[ex.exerciseId]
          const exVol = (ex.sets||[]).filter(s=>s.done&&s.weight&&s.reps).reduce((s,st)=>(+st.weight)*(+st.reps)+s,0)
          const best  = ex.sets.filter(s=>s.done&&s.weight&&s.reps).length
            ? Math.max(...ex.sets.filter(s=>s.done&&s.weight&&s.reps).map(s=>calc1RM(+s.weight,+s.reps)))
            : null

          return (
            <div key={ei} style={{ ...card({ marginBottom:12 }) }}>
              {/* Exercise header */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
                <div>
                  <span style={{ display:'inline-block', padding:'2px 8px', background:(CAT_COLORS[ex.cat]||C.textSub)+'22', color:CAT_COLORS[ex.cat]||C.textSub, borderRadius:20, fontSize:10, fontWeight:700, letterSpacing:'0.06em', marginBottom:4 }}>{ex.cat||'Exercise'}</span>
                  <div style={{ fontFamily:F.head, fontWeight:700, fontSize:15 }}>{ex.name}</div>
                  <div style={{ fontSize:11, color:C.textSub, marginTop:2 }}>
                    {exVol>0&&<span>{exVol.toLocaleString()} kg vol</span>}
                    {best&&<span style={{ marginLeft:8, color:C.purple }}>Est. 1RM: {best} kg</span>}
                  </div>
                </div>
                <button onClick={()=>removeEx(ei)} style={{ background:'none', border:'none', color:C.textSub, cursor:'pointer', fontSize:18, padding:'4px 8px' }}
                  onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.textSub}>×</button>
              </div>

              {/* Column headers */}
              <div style={{ display:'grid', gridTemplateColumns:'28px 1fr 1fr 1fr 36px', gap:6, padding:'0 2px', marginBottom:6 }}>
                {['SET','PREV','KG','REPS','✓'].map(h=>(
                  <div key={h} style={{ fontSize:10, color:C.textSub, fontWeight:600, letterSpacing:'0.07em', textAlign:'center' }}>{h}</div>
                ))}
              </div>

              {/* Sets */}
              {ex.sets.map((set,si)=>{
                const ps = prev?.[si]
                return (
                  <div key={set.id} style={{ display:'grid', gridTemplateColumns:'28px 1fr 1fr 1fr 36px', gap:6, marginBottom:5, alignItems:'center', background:set.done?'rgba(167,139,250,0.1)':'transparent', borderRadius:8, padding:'3px 2px', transition:'background 0.2s' }}>
                    <div style={{ textAlign:'center', fontFamily:F.mono, fontSize:12, color:set.done?C.accent:C.textSub, fontWeight:set.done?700:400 }}>{set.setNum}</div>
                    <div style={{ textAlign:'center', fontSize:11, color:C.textSub, fontFamily:F.mono }}>
                      {ps?.weight&&ps?.reps ? `${ps.weight}×${ps.reps}` : '—'}
                    </div>
                    <input style={{ ...inp({ textAlign:'center', padding:'7px 4px', fontSize:14, fontFamily:F.mono }), borderColor:set.done?`${C.accent}55`:C.border }}
                      type="number" inputMode="decimal" step="0.5" value={set.weight} placeholder="kg"
                      onChange={e=>updSet(ei,si,'weight',e.target.value)} />
                    <input style={{ ...inp({ textAlign:'center', padding:'7px 4px', fontSize:14, fontFamily:F.mono }), borderColor:set.done?`${C.accent}55`:C.border }}
                      type="number" inputMode="decimal" value={set.reps} placeholder={String(ex.repsTarget||8)}
                      onChange={e=>updSet(ei,si,'reps',e.target.value)} />
                    <button onClick={()=>toggleDone(ei,si)} style={{ width:34, height:34, borderRadius:8, border:`2px solid ${set.done?C.accent:C.border}`, background:set.done?C.accent:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.15s', padding:0 }}>
                      {set.isPR
                        ? <Icon name="trophy" size={15} color="#000" />
                        : set.done
                          ? <span style={{ color:'#000', fontWeight:800, fontSize:14 }}>✓</span>
                          : <span style={{ color:C.textSub, fontSize:12 }}>✓</span>}
                    </button>
                  </div>
                )
              })}

              {/* Remove set */}
              {ex.sets.length > 1 && (
                <button style={{ ...btn(false,true), fontSize:11, marginTop:4, padding:'4px 10px', color:C.red, borderColor:'transparent' }}
                  onClick={()=>removeSet(ei,ex.sets.length-1)}>− Remove Last Set</button>
              )}
              <button style={{ ...btn(false,true), width:'100%', marginTop:6, fontSize:12, borderStyle:'dashed' }} onClick={()=>addSet(ei)}>+ Add Set</button>
            </div>
          )
        })}

        <button style={{ ...btn(false,true), width:'100%', marginBottom:12 }} onClick={()=>setPicker(true)}>+ Add Exercise</button>

        <div style={{ ...card({ marginBottom:20 }) }}>
          <label style={LBL}>Workout Notes</label>
          <textarea style={{ ...inp({ width:'100%', boxSizing:'border-box', minHeight:70, resize:'vertical' }) }}
            value={notes} placeholder="How did it feel? PRs? Energy levels?" onChange={e=>setNotes(e.target.value)} />
        </div>
      </div>

      {restTimer && <RestTimer key={restTimer.key} seconds={restTimer.seconds} onDismiss={()=>setRestTimer(null)} />}
      {picker    && <ExerciseSelector onSelect={addEx} onClose={()=>setPicker(false)} />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   WORKOUT DETAIL VIEW
═══════════════════════════════════════════════════════════════ */
function WorkoutDetail({ workout, onBack, onDelete }) {
  const volume    = calcVolume(workout.exercises)
  const totalSets = workout.exercises.reduce((s,ex)=>s+(ex.sets||[]).length,0)
  const hasPR     = workout.exercises.some(ex=>(ex.sets||[]).some(s=>s.isPR))

  return (
    <div style={{ padding:'16px', maxWidth:700, margin:'0 auto', paddingBottom:40 }}>
      <div style={{ display:'flex', gap:10, marginBottom:20, alignItems:'center' }}>
        <button onClick={onBack} style={{ background:'none', border:'none', color:C.textSub, cursor:'pointer', fontSize:22, padding:'4px 8px', lineHeight:1 }}>←</button>
        <div style={{ flex:1 }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:8, fontFamily:F.head, fontWeight:800, fontSize:20 }}>
            {workout.routineName} {hasPR&&<Icon name="trophy" size={18} color={C.gold} />}
          </div>
          <div style={{ fontSize:12, color:C.textSub, marginTop:2 }}>{fmtDate(workout.date)}</div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:20 }}>
        {[
          { label:'Duration',   val:fmtDur(workout.duration||0), color:C.accent  },
          { label:'Volume',     val:`${volume.toLocaleString()} kg`, color:C.blue },
          { label:'Total Sets', val:`${totalSets} sets`,          color:C.purple  },
        ].map(({label,val,color})=>(
          <div key={label} style={{ ...card({ textAlign:'center', padding:'12px 8px' }) }}>
            <div style={{ fontFamily:F.mono, fontSize:16, fontWeight:700, color }}>{val}</div>
            <div style={{ fontSize:10, color:C.textSub, marginTop:4, textTransform:'uppercase', letterSpacing:'0.07em' }}>{label}</div>
          </div>
        ))}
      </div>

      {workout.exercises.map((ex,i)=>(
        <div key={i} style={{ ...card({ marginBottom:12 }) }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <div style={{ fontFamily:F.head, fontWeight:700, fontSize:14 }}>{ex.name}</div>
            <div style={{ fontSize:11, color:C.textSub }}>{(ex.sets||[]).length} sets</div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'28px 1fr 1fr 1fr', gap:6, padding:'0 4px', marginBottom:6 }}>
            {['SET','KG','REPS','1RM'].map(h=>(
              <div key={h} style={{ fontSize:10, color:C.textSub, fontWeight:600, letterSpacing:'0.07em', textAlign:'center' }}>{h}</div>
            ))}
          </div>
          {(ex.sets||[]).map((s,si)=>(
            <div key={si} style={{ display:'grid', gridTemplateColumns:'28px 1fr 1fr 1fr', gap:6, padding:'7px 4px', background:si%2===0?'rgba(255,255,255,0.02)':'transparent', borderRadius:6, alignItems:'center' }}>
              <div style={{ textAlign:'center', fontFamily:F.mono, fontSize:12, color:C.textSub }}>{si+1}</div>
              <div style={{ textAlign:'center', fontFamily:F.mono, fontSize:13 }}>{s.weight||'—'}</div>
              <div style={{ textAlign:'center', fontFamily:F.mono, fontSize:13 }}>{s.reps||'—'}</div>
              <div style={{ textAlign:'center', fontFamily:F.mono, fontSize:12, color:s.isPR?C.gold:C.textSub }}>
                {s.weight&&s.reps ? calc1RM(+s.weight,+s.reps) : '—'}
                {s.isPR&&<span style={{ display:'inline-flex', marginLeft:4, verticalAlign:'middle' }}><Icon name="trophy" size={12} color={C.gold} /></span>}
              </div>
            </div>
          ))}
        </div>
      ))}

      {workout.notes && (
        <div style={{ ...card({ marginBottom:16 }) }}>
          <div style={{ fontSize:11, color:C.textSub, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.07em' }}>Notes</div>
          <div style={{ fontSize:14, color:C.text, lineHeight:1.5 }}>{workout.notes}</div>
        </div>
      )}

      <button style={{ ...btn(false,true), color:C.red, width:'100%' }} onClick={onDelete}>Delete Workout</button>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   PROGRESS CHARTS  (bottom-sheet)
═══════════════════════════════════════════════════════════════ */
function ProgressCharts({ history, onClose }) {
  const [selEx, setSelEx] = useState(null)
  const exMap = {}
  history.forEach(w=>w.exercises?.forEach(ex=>{ if(!exMap[ex.exerciseId]) exMap[ex.exerciseId]=ex.name }))
  const exList = Object.entries(exMap)

  const data = useMemo(()=>{
    if (!selEx) return []
    return history
      .filter(w=>w.exercises?.some(e=>e.exerciseId===selEx))
      .sort((a,b)=>a.date.localeCompare(b.date))
      .map(w=>{
        const ex    = w.exercises.find(e=>e.exerciseId===selEx)
        const sets  = (ex?.sets||[]).filter(s=>s.weight&&s.reps)
        const best1 = sets.length ? Math.max(...sets.map(s=>calc1RM(+s.weight,+s.reps))) : 0
        const vol   = sets.reduce((s,st)=>(+st.weight)*(+st.reps)+s,0)
        return { date:w.date.slice(5), best1rm:best1, vol }
      })
  },[selEx,history])

  return (
    <div style={{ position:'fixed', inset:0, background:'#000b', zIndex:500, display:'flex', alignItems:'flex-end' }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:C.bg, width:'100%', maxHeight:'90vh', borderRadius:'16px 16px 0 0', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'16px 18px', borderBottom:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', flexShrink:0 }}>
          <div style={{ fontFamily:F.head, fontWeight:700, fontSize:16 }}>Exercise Progress</div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.textSub, cursor:'pointer', fontSize:24, lineHeight:1 }}>×</button>
        </div>
        <div style={{ overflowY:'auto', flex:1, padding:'16px 18px' }}>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:20 }}>
            {exList.map(([id,name])=>(
              <button key={id} style={{ ...btn(selEx===id,true), fontSize:12 }} onClick={()=>setSelEx(id)}>{name}</button>
            ))}
          </div>
          {exList.length===0 && <div style={{ textAlign:'center', padding:'40px 0', color:C.textSub }}>Complete some workouts to see progress</div>}
          {selEx && data.length > 0 && (<>
            <div style={{ fontFamily:F.head, fontWeight:700, fontSize:14, marginBottom:12 }}>Estimated 1RM (kg)</div>
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={data} margin={{top:5,right:10,bottom:5,left:-20}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                <XAxis dataKey="date" tick={{fill:C.textSub,fontSize:10}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fill:C.textSub,fontSize:10}} tickLine={false} axisLine={false}/>
                <Tooltip {...TT}/>
                <Line type="monotone" dataKey="best1rm" stroke={C.accent} strokeWidth={2.5} dot={{fill:C.accent,r:3,strokeWidth:0}} name="Est. 1RM (kg)"/>
              </LineChart>
            </ResponsiveContainer>
            <div style={{ fontFamily:F.head, fontWeight:700, fontSize:14, margin:'20px 0 12px' }}>Volume per Session (kg)</div>
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={data} margin={{top:5,right:10,bottom:5,left:-20}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                <XAxis dataKey="date" tick={{fill:C.textSub,fontSize:10}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fill:C.textSub,fontSize:10}} tickLine={false} axisLine={false}/>
                <Tooltip {...TT}/>
                <Line type="monotone" dataKey="vol" stroke={C.blue} strokeWidth={2} dot={{fill:C.blue,r:3,strokeWidth:0}} name="Volume (kg)"/>
              </LineChart>
            </ResponsiveContainer>
          </>)}
          {selEx && data.length===0 && <div style={{ textAlign:'center', padding:'40px 0', color:C.textSub }}>No data for this exercise yet</div>}
          {!selEx && exList.length>0 && <div style={{ textAlign:'center', padding:'40px 0', color:C.textSub }}>Select an exercise above</div>}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   MAIN WORKOUT TAB
═══════════════════════════════════════════════════════════════ */
export default function WorkoutTab() {
  const mobile = useIsMobile()
  const [routines,       setRoutines]       = useState([])
  const [history,        setHistory]        = useState([])
  const [activeWorkout,  setActiveWorkout]  = useState(null)
  const [view,           setView]           = useState('home')
  const [editingRoutine, setEditingRoutine] = useState(null)
  const [selectedLog,    setSelectedLog]    = useState(null)
  const [subTab,         setSubTab]         = useState('routines')
  const [showProgress,   setShowProgress]   = useState(false)
  const [loaded,         setLoaded]         = useState(false)

  useEffect(()=>{
    Promise.all([store.get('routines'),store.get('workout_history')]).then(([r,h])=>{
      setRoutines(r||[]); setHistory(h||[]); setLoaded(true)
    })
  },[])

  const saveRoutines = async r => { await store.set('routines',r); setRoutines(r) }
  const saveHistory  = async h => { await store.set('workout_history',h); setHistory(h) }

  const startWorkout = r => setActiveWorkout({
    routineId:r.id, routineName:r.name,
    exercises:r.exercises.map(ex=>({ exerciseId:ex.exerciseId||ex.id, name:ex.name, cat:ex.cat||'', restSeconds:ex.restSeconds||90, repsTarget:ex.repsTarget||8, setsCount:ex.sets||3 }))
  })

  const finishWorkout = async log => {
    const updated=[log,...history]
    await saveHistory(updated)
    buzz([20, 60, 30])
    setActiveWorkout(null); setSubTab('history')
  }

  const deleteRoutine = async id => { if(!confirm('Delete this routine?')) return; await saveRoutines(routines.filter(r=>r.id!==id)) }
  const deleteLog     = async id => { if(!confirm('Delete this workout?')) return; await saveHistory(history.filter(w=>w.id!==id)); setView('home') }

  if (!loaded) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'60px 0', color:C.accent, fontFamily:F.mono }}>Loading workouts…</div>
  )
  if (activeWorkout) return <ActiveWorkout workout={activeWorkout} workoutHistory={history} onFinish={finishWorkout} onCancel={()=>setActiveWorkout(null)} />
  if (view==='edit') return (
    <RoutineEditor routine={editingRoutine}
      onSave={async r=>{ const upd=editingRoutine?routines.map(x=>x.id===r.id?r:x):[...routines,r]; await saveRoutines(upd); setView('home'); setEditingRoutine(null) }}
      onCancel={()=>{ setView('home'); setEditingRoutine(null) }} />
  )
  if (view==='detail'&&selectedLog) return (
    <WorkoutDetail workout={selectedLog} onBack={()=>setView('home')} onDelete={()=>deleteLog(selectedLog.id)} />
  )

  return (
    <div style={{ padding:mobile?'12px':'20px', maxWidth:700, margin:'0 auto' }}>

      {/* Quick start + new routine */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:20 }}>
        <button style={{ ...btn(false), padding:'16px 0', display:'flex', flexDirection:'column', alignItems:'center', gap:6, background:C.surface }}
          onClick={()=>setActiveWorkout({ routineId:null, routineName:'Quick Workout', exercises:[] })}>
          <Icon name="dumbbell" size={22} color={C.accent} />
          <span style={{ fontSize:13, fontWeight:600 }}>Quick Start</span>
          <span style={{ fontSize:11, color:C.textSub }}>Empty workout</span>
        </button>
        <button style={{ ...btn(true), padding:'16px 0', display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}
          onClick={()=>{ setEditingRoutine(null); setView('edit') }}>
          <span style={{ fontSize:24 }}>+</span>
          <span style={{ fontSize:13, fontWeight:600 }}>New Routine</span>
          <span style={{ fontSize:11 }}>Create template</span>
        </button>
      </div>

      {/* Sub-tab bar */}
      <div style={{ display:'flex', gap:4, marginBottom:16, background:C.surface, borderRadius:10, padding:4 }}>
        {[
          { id:'routines', label:'Routines'  },
          { id:'history',  label:'History'   },
          { id:'progress', label:'Progress'  },
        ].map(t=>(
          <button key={t.id} onClick={()=>t.id==='progress'?setShowProgress(true):setSubTab(t.id)}
            style={{ flex:1, padding:'8px 0', borderRadius:7, border:'none', cursor:'pointer', fontFamily:F.body, fontSize:13, fontWeight:500, transition:'all 0.15s',
              background:subTab===t.id&&t.id!=='progress'?C.bg:'transparent',
              color:subTab===t.id&&t.id!=='progress'?C.text:C.textSub }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Routines list ── */}
      {subTab==='routines' && (<>
        {routines.length===0 ? (
          <div style={{ textAlign:'center', padding:'52px 20px', color:C.textSub }}>
            <div style={{ display:'flex', justifyContent:'center', marginBottom:14 }}><Icon name="dumbbell" size={40} color={C.textFaint} /></div>
            <div style={{ fontSize:15, color:C.text, marginBottom:8 }}>No routines yet</div>
            <div style={{ fontSize:13 }}>Create a routine above to start tracking</div>
          </div>
        ) : (
          <div style={{ display:'grid', gap:10 }}>
            {routines.map(r=>{
              const lastDone = history.find(w=>w.routineId===r.id)
              return (
                <div key={r.id} style={card()}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
                    <div>
                      <div style={{ fontFamily:F.head, fontWeight:700, fontSize:16 }}>{r.name}</div>
                      <div style={{ fontSize:12, color:C.textSub, marginTop:3 }}>
                        {r.exercises.length} exercise{r.exercises.length!==1?'s':''} &nbsp;·&nbsp;
                        {lastDone?`Last: ${fmtDate(lastDone.date)}`:'Never done'}
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:6 }}>
                      <button style={btn(false,true)} onClick={()=>{ setEditingRoutine(r); setView('edit') }}>✎</button>
                      <button style={{ ...btn(false,true), color:C.red }} onClick={()=>deleteRoutine(r.id)}>×</button>
                    </div>
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12 }}>
                    {r.exercises.map((ex,i)=>(
                      <span key={i} style={{ padding:'3px 9px', background:(CAT_COLORS[ex.cat]||C.textSub)+'18', color:CAT_COLORS[ex.cat]||C.textSub, borderRadius:20, fontSize:11, fontWeight:500 }}>
                        {ex.name}
                      </span>
                    ))}
                  </div>
                  <button style={{ ...btn(true), width:'100%', padding:'11px 0', fontSize:14 }} onClick={()=>startWorkout(r)}>
                    ▶ Start Workout
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </>)}

      {/* ── History list ── */}
      {subTab==='history' && (<>
        {history.length===0 ? (
          <div style={{ textAlign:'center', padding:'52px 20px', color:C.textSub }}>
            <div style={{ display:'flex', justifyContent:'center', marginBottom:14 }}><Icon name="clipboard" size={40} color={C.textFaint} /></div>
            <div style={{ fontSize:15, color:C.text, marginBottom:8 }}>No workouts logged yet</div>
            <div style={{ fontSize:13 }}>Finish a workout to see your history here</div>
          </div>
        ) : (
          <div style={{ display:'grid', gap:10 }}>
            {history.slice(0,50).map(w=>{
              const vol   = calcVolume(w.exercises)
              const sets  = w.exercises.reduce((s,ex)=>s+(ex.sets||[]).length,0)
              const hasPR = w.exercises.some(ex=>(ex.sets||[]).some(s=>s.isPR))
              return (
                <button key={w.id} onClick={()=>{ setSelectedLog(w); setView('detail') }}
                  style={{ ...card(), textAlign:'left', cursor:'pointer', transition:'border-color 0.15s', width:'100%', fontFamily:F.body }}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=C.accent}
                  onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                    <div>
                      <div style={{ fontFamily:F.head, fontWeight:700, fontSize:15 }}>
                        {w.routineName}{hasPR&&<span style={{ display:'inline-flex', marginLeft:6, verticalAlign:'middle' }}><Icon name="trophy" size={14} color={C.gold} /></span>}
                      </div>
                      <div style={{ fontSize:12, color:C.textSub, marginTop:2 }}>{fmtDate(w.date)}</div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontFamily:F.mono, fontSize:13, color:C.accent }}>{fmtDur(w.duration||0)}</div>
                      <div style={{ fontSize:11, color:C.textSub, marginTop:2 }}>{sets} sets</div>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:14, fontSize:12, color:C.textSub }}>
                    <span>{vol.toLocaleString()} kg volume</span>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}><Icon name="dumbbell" size={13} color={C.textSub} /> {w.exercises.length} exercises</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </>)}

      {showProgress && <ProgressCharts history={history} onClose={()=>setShowProgress(false)} />}
    </div>
  )
}
