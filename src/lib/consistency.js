import { completeFood, createTargetResolver, daySpan, getDynamicStepGoal, shiftDay, today } from './planEngine.js'
import { hasSleep, hasSteps, numeric, reviewFields, validDate, withinCalorieTarget } from './modelInputs.js'

export const HABITS = ['diet', 'steps', 'sleep']
export const SLEEP_GOAL = 7

// Saved totals count immediately; missing and disputed facts remain distinct.
export function consistencyDay(log, { calorieTarget = null, stepGoal = null } = {}) {
  const disputed = new Set(reviewFields(log))
  const meals = Array.isArray(log?.meals) ? log.meals : []
  const calories = meals.reduce((sum, meal) => sum + (numeric(meal?.cals) ?? 0), 0)
  const steps = numeric(log?.steps), sleep = numeric(log?.sleep)
  const foodDone = completeFood(log)
  const foodStatus = disputed.has('meals') ? 'review'
    : !foodDone ? (meals.length || log?.foodComplete ? 'invalid' : 'missing')
    : !(calorieTarget > 0) ? 'unknown'
    : withinCalorieTarget(calories, calorieTarget) ? 'met' : 'missed'
  const stepStatus = disputed.has('steps') ? 'review'
    : steps == null || steps < 0 || steps > 100000 ? 'missing'
    : !hasSteps(log) ? 'invalid'
    : stepGoal == null || stepGoal < 0 ? 'unknown' : steps >= stepGoal ? 'met' : 'missed'
  const sleepStatus = disputed.has('sleep') ? 'review'
    : !hasSleep(log) ? 'missing' : sleep >= SLEEP_GOAL ? 'met' : 'missed'
  const habits = {
    diet: { status: foodStatus, value: log?.meals?.length || foodDone ? calories : null, target: calorieTarget },
    steps: { status: stepStatus, value: steps, target: stepGoal },
    sleep: { status: sleepStatus, value: sleep, target: SLEEP_GOAL },
  }
  return { date: log?.date, habits, score: HABITS.filter(key => habits[key].status === 'met').length }
}

export function consistencyHistory({ logs = [], setup, cutIntel, workoutHistory, currentPlan, resolveTargets, asOfDate = today() }) {
  const start = validDate(setup?.startDate) ? setup.startDate : asOfDate
  const scoped = logs.filter(log => validDate(log.date) && log.date >= start && log.date <= asOfDate)
  const targetsFor = resolveTargets || createTargetResolver({ setup, logs:scoped, cutIntel, workoutHistory, currentPlan, asOfDate })
  const byDate = new Map(scoped.map(l => [l.date, l]))
  const stepGoal = getDynamicStepGoal(setup, [], cutIntel?.stepGoal).goal
  return Array.from({ length: Math.max(0, daySpan(start, asOfDate) + 1) }, (_, index) => {
    const date = shiftDay(start, index)
    const log = byDate.get(date)
    if (!log) {
      const empty = consistencyDay(null, { stepGoal })
      // Empty days have no score to compute. Only resolve their calorie
      // allowance if the user opens that date's detail.
      Object.defineProperty(empty.habits.diet, 'target', { enumerable:true, get:() => targetsFor(date).calories })
      return { ...empty, date, estimatedTargets:date < asOfDate }
    }
    const targets = targetsFor(date)
    return { ...consistencyDay(log, { calorieTarget:targets.calories, stepGoal:targets.steps }), estimatedTargets:targets.estimated }
  })
}

export const habitMet = (day, habit = 'all') => habit === 'all' ? day?.score === 3 : day?.habits[habit]?.status === 'met'
export const habitHasData = (day, habit = 'all') => !!day && (habit === 'all'
  ? HABITS.some(key => day.habits[key].status !== 'missing') : day.habits[habit]?.status !== 'missing')

export function consistencyStats(days, habit = 'all', asOfDate = today()) {
  const byDate = new Map(days.map(day => [day.date, day]))
  let best = 0, run = 0
  for (const day of days) {
    // A calendar gap must break the run even if a caller supplies sparse days.
    run = habitMet(day, habit) ? (habitMet(byDate.get(shiftDay(day.date, -1)), habit) ? run : 0) + 1 : 0
    best = Math.max(best, run)
  }
  let date = habitMet(byDate.get(asOfDate), habit) ? asOfDate : shiftDay(asOfDate, -1)
  let current = 0
  while (habitMet(byDate.get(date), habit)) { current++; date = shiftDay(date, -1) }
  return { current, best }
}

export function calendarYear(year) {
  const first = `${year}-01-01`, last = `${year}-12-31`
  const start = shiftDay(first, -new Date(`${first}T12:00:00Z`).getUTCDay())
  const length = Math.ceil((daySpan(start, last) + 1) / 7) * 7
  return Array.from({ length }, (_, index) => shiftDay(start, index))
}
