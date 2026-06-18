/* ═══════════════════════════════════════════════════════════════
   DEV / DEMO MODE  — gated behind the VITE_DEMO build flag.

   • Vercel/production builds never set VITE_DEMO, so this file is
     completely inert there (DEMO === false → the real Supabase store
     and auth flow are used unchanged).
   • Run `VITE_DEMO=1 npm run dev` (or build) to launch a no-backend,
     no-signup demo seeded with a realistic 12-day cut. Used for visual
     QA of every tab, and handy as a "try it" link for friends.
═══════════════════════════════════════════════════════════════ */
export const DEMO =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_DEMO === '1')

// A fake Supabase session so <App> skips the AuthScreen in demo mode.
export const demoSession = { user: { id: 'demo-user', email: 'demo@cutboard.app' } }

/* ── date helpers (local-noon, matches the app's todayStr) ──────── */
const pad = n => String(n).padStart(2, '0')
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const daysAgo = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return dstr(d) }

const SPAN = 11           // started 11 days ago → today is Day 12 of 60
const START_W = 76.7
const TODAY_W = 73.5

// Today's meals — engineered to total exactly 1420 kcal · 96P · 130C · 42F · 22 fibre
const TODAY_MEALS = [
  { name: 'Dal-rice-ghee bowl',     cals: 520, protein: 18, carbs: 78, fat: 14, fiber: 9 },
  { name: 'Whey + banana shake',    cals: 280, protein: 31, carbs: 30, fat: 4,  fiber: 3 },
  { name: 'Chicken breast 200g',    cals: 330, protein: 40, carbs: 0,  fat: 7,  fiber: 0 },
  { name: 'Greek yogurt + berries', cals: 290, protein: 7,  carbs: 22, fat: 17, fiber: 10 },
]

const SCALE_NOISE = [0, 0.1, -0.2, 0.3, -0.1, 0.2, -0.3, 0.4, -0.2, 0.1, 0.3, -0.1]

function buildLogs() {
  const logs = []
  for (let i = SPAN; i >= 0; i--) {
    const isToday = i === 0
    const t = (SPAN - i) / SPAN                                   // 0 → 1 over the cut
    const weight = isToday
      ? TODAY_W
      : Math.round((START_W - (START_W - TODAY_W) * t + (SCALE_NOISE[i] || 0)) * 10) / 10
    const sleep = Math.round((6.8 + Math.sin(i * 1.1) * 0.5 + (isToday ? 0.7 : 0)) * 10) / 10
    const steps = isToday ? 8200 : 6800 + ((i * 617) % 3000)
    let meals
    if (isToday) {
      meals = TODAY_MEALS
    } else {
      const cals = 1600 + ((i * 123) % 320)                      // 1600 … 1920
      meals = [{
        name: 'Logged intake',
        cals,
        protein: 112 + (i % 5) * 4,
        carbs: Math.round(cals * 0.09),
        fat: Math.round(cals * 0.026),
        fiber: 18 + (i % 6) * 2,
      }]
    }
    logs.push({
      date: daysAgo(i), weight, sleep,
      sleepQuality: sleep >= 7.2 ? 'Good' : sleep >= 6.8 ? 'OK' : 'Poor',
      steps, inclineMin: null, meals, notes: '', fasting: false, fastingOverridden: false,
    })
  }
  return logs
}

const SETUP = {
  name: 'Vishudh', age: 24, height: 178, sex: 'male', activity: 'mod',
  startWeight: START_W, startBF: 20, goalBF: 12,
  startDate: daysAgo(SPAN), cutLength: 60, stepGoal: 8000,
  carbCycling: false, trainingDays: [1, 3, 5], manualCalTarget: '',
  activeCut: false, cardioMin: 35,
}

const RECIPES = [
  { id: 'rec_dal',  name: 'Dal-rice-ghee bowl', items: [{}, {}, {}, {}], perServing: { cals: 520, protein: 18, carbs: 78, fat: 14, fiber: 9 } },
  { id: 'rec_whey', name: 'Whey + banana shake', items: [{}, {}, {}],     perServing: { cals: 280, protein: 31, carbs: 30, fat: 4,  fiber: 3 } },
]

const MEAL_HISTORY = [
  { name: 'Dal-rice-ghee bowl',     cals: 520, protein: 18, carbs: 78, fat: 14, fiber: 9,  count: 7, lastUsed: daysAgo(0) },
  { name: 'Whey + banana shake',    cals: 280, protein: 31, carbs: 30, fat: 4,  fiber: 3,  count: 6, lastUsed: daysAgo(0) },
  { name: 'Chicken breast 200g',    cals: 330, protein: 40, carbs: 0,  fat: 7,  fiber: 0,  count: 5, lastUsed: daysAgo(1) },
  { name: 'Greek yogurt + berries', cals: 290, protein: 7,  carbs: 22, fat: 17, fiber: 10, count: 4, lastUsed: daysAgo(1) },
]

const ex = (id, name, cat) => ({ exerciseId: id, name, cat, sets: 4, repsTarget: 8, restSeconds: 120 })
const ROUTINES = [
  { id: 'r_push', name: 'Push Day', exercises: [
    ex('bench_press', 'Bench Press', 'Chest'), ex('ohp', 'Overhead Press', 'Shoulders'),
    ex('incline_db_bench', 'Incline DB Bench Press', 'Chest'), ex('lateral_raise', 'Lateral Raise', 'Shoulders'),
    ex('cable_fly', 'Cable Crossover', 'Chest'),
  ] },
  { id: 'r_pull', name: 'Pull Day', exercises: [
    ex('deadlift', 'Deadlift', 'Back'), ex('pull_up', 'Pull Up', 'Back'),
    ex('barbell_row', 'Barbell Row', 'Back'), ex('lat_pulldown', 'Lat Pulldown', 'Back'),
    ex('db_row', 'Dumbbell Row', 'Back'), ex('barbell_shrug', 'Barbell Shrug', 'Back'),
  ] },
]

const set = (weight, reps, isPR = false) => ({ weight, reps, isPR, done: true })
const WORKOUTS = [
  { id: 'w1', routineName: 'Push Day', date: daysAgo(2), endTime: new Date().toISOString(), duration: 52 * 60,
    exercises: [
      { exerciseId: 'bench_press', name: 'Bench Press', cat: 'Chest', sets: [set(80, 8, true), set(80, 8), set(82, 6), set(75, 9)] },
      { exerciseId: 'ohp', name: 'Overhead Press', cat: 'Shoulders', sets: [set(50, 8), set(50, 7), set(45, 9)] },
      { exerciseId: 'incline_db_bench', name: 'Incline DB Bench Press', cat: 'Chest', sets: [set(30, 10), set(30, 9), set(28, 11)] },
      { exerciseId: 'lateral_raise', name: 'Lateral Raise', cat: 'Shoulders', sets: [set(12, 15), set(12, 14), set(10, 16)] },
      { exerciseId: 'cable_fly', name: 'Cable Crossover', cat: 'Chest', sets: [set(20, 14), set(20, 13), set(18, 15)] },
    ] },
  { id: 'w2', routineName: 'Pull Day', date: daysAgo(4), endTime: new Date().toISOString(), duration: 58 * 60,
    exercises: [
      { exerciseId: 'deadlift', name: 'Deadlift', cat: 'Back', sets: [set(140, 5, true), set(140, 5), set(120, 8)] },
      { exerciseId: 'pull_up', name: 'Pull Up', cat: 'Back', sets: [set(0, 10), set(0, 9), set(0, 8)] },
      { exerciseId: 'barbell_row', name: 'Barbell Row', cat: 'Back', sets: [set(70, 10), set(70, 9), set(65, 11)] },
    ] },
]

const seed = {
  setup: SETUP,
  cut_intel: { anchor: { date: daysAgo(SPAN), weight: START_W, bf: 20 }, strengthSignal: 'same', strengthWeek: 0, cardioMin: 0 },
  meal_history: MEAL_HISTORY,
  recipes: RECIPES,
  plan_settings: { fastingDays: [], fastCompensation: false },
  zigzag_settings: { on: false, schedule: 1, mode: 'weight' },
  routines: ROUTINES,
  workout_history: WORKOUTS,
}
buildLogs().forEach(l => { seed[`log:${l.date}`] = l })

// In-memory, Promise-returning store with the same surface as lib/store.js
const mem = new Map(Object.entries(seed))
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)))

export const demoStore = {
  async get(key) { return mem.has(key) ? clone(mem.get(key)) : null },
  async set(key, value) { mem.set(key, clone(value)) },
  async list(prefix) { return [...mem.keys()].filter(k => k.startsWith(prefix)) },
  async getByPrefix(prefix) {
    return [...mem.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => clone(v)).filter(Boolean)
  },
  async clearAll() { mem.clear(); return true },
  async getSharedFoods() { return [] },
  async addSharedFood() { return true },
  async uploadPhoto() { return null },
  async listPhotos() { return [] },
  async photoUrl() { return null },
  async deletePhoto() { return true },
}
