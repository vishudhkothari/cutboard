import { aggregateMealNutrition, compareMicros } from './nutrientEngine'
import { computeFoodNutrition } from './foodDB'
import { getNutrientTargets } from './nutrientTargets'

const round = n => Math.round((+n || 0) * 10) / 10

export function getLoggedMealNutrition(meal, foodMap = {}, recipeMap = {}) {
  if (meal?.micros) return meal
  if (meal?.foodId && foodMap[meal.foodId] && meal.amount != null) {
    const computed = computeFoodNutrition(foodMap[meal.foodId], +meal.amount)
    return { ...meal, micros: computed.micros }
  }
  if (meal?.recipeId && recipeMap[meal.recipeId]?.perServing?.micros) {
    const ps = recipeMap[meal.recipeId].perServing
    const factor = +meal.amount || 1
    return { ...meal, micros: Object.fromEntries(Object.entries(ps.micros).map(([k,v]) => [k, round(v * factor)])) }
  }
  return meal
}

export function getDayMicronutrients(log, { foods = [], recipes = [], setup } = {}) {
  const foodMap = Object.fromEntries(foods.map(f => [f.id, f]))
  const recipeMap = Object.fromEntries(recipes.map(r => [r.id, r]))
  const meals = (log?.meals || []).map(m => getLoggedMealNutrition(m, foodMap, recipeMap))
  const aggregate = aggregateMealNutrition(meals)
  const targets = getNutrientTargets(setup)
  return { ...aggregate, comparison: compareMicros(aggregate.micros, targets), mealsWithData: meals.filter(m => m?.micros).length, totalMeals: meals.length }
}

export function rankFoodSuggestions(gap, foods = [], { remainingCalories = Infinity, remainingFat = Infinity } = {}) {
  if (!gap?.id || !gap.target || gap.consumed == null || gap.consumed >= gap.target) return []
  const needed = gap.target - gap.consumed
  return foods
    .filter(f => f?.micros?.[gap.id] > 0)
    .map(food => {
      const serving = food.unit === 'g' || food.unit === 'ml' ? Math.min(100, Math.max(1, remainingCalories === Infinity ? 100 : 100)) : 1
      const nutrition = computeFoodNutrition(food, serving)
      const nutrient = nutrition.micros?.[gap.id] || 0
      const calories = nutrition.cals || 0
      const fills = Math.min(1, nutrient / needed)
      const calorieFit = remainingCalories === Infinity ? 1 : Math.max(0, Math.min(1, (remainingCalories + 1) / Math.max(1, calories)))
      const fatFit = remainingFat === Infinity ? 1 : Math.max(0, Math.min(1, (remainingFat + 1) / Math.max(1, nutrition.fat)))
      return { food, serving, nutrition, fills: round(fills), score: fills * 0.65 + calorieFit * 0.25 + fatFit * 0.1 }
    })
    .sort((a,b) => b.score - a.score)
    .slice(0, 5)
}

export function getNutritionCoach(dayNutrition, foods, options = {}) {
  const gaps = dayNutrition.comparison.filter(n => n.status === 'low' || n.status === 'very_low')
  return gaps.slice(0, 4).map(gap => ({ ...gap, suggestions: rankFoodSuggestions(gap, foods, options) }))
}
