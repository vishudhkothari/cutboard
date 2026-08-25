/*
 * Micronutrient accounting primitives.
 *
 * This module deliberately has no React or storage dependencies. Food records
 * may provide `micros` per 100g (or per unit through the normal food scaling
 * rules); older records without micronutrients remain valid and are reported
 * as unknown instead of being treated as zero.
 */

export const NUTRIENTS = [
  { id:'calcium_mg',    label:'Calcium',    unit:'mg', group:'Minerals' },
  { id:'iron_mg',       label:'Iron',       unit:'mg', group:'Minerals' },
  { id:'magnesium_mg',  label:'Magnesium',  unit:'mg', group:'Minerals' },
  { id:'phosphorus_mg', label:'Phosphorus', unit:'mg', group:'Minerals' },
  { id:'potassium_mg',  label:'Potassium',  unit:'mg', group:'Minerals' },
  { id:'sodium_mg',     label:'Sodium',     unit:'mg', group:'Minerals' },
  { id:'zinc_mg',       label:'Zinc',        unit:'mg', group:'Minerals' },
  { id:'copper_mg',     label:'Copper',      unit:'mg', group:'Minerals' },
  { id:'selenium_ug',   label:'Selenium',    unit:'µg', group:'Minerals' },
  { id:'vitamin_a_ug',  label:'Vitamin A',   unit:'µg', group:'Vitamins' },
  { id:'vitamin_c_mg',  label:'Vitamin C',   unit:'mg', group:'Vitamins' },
  { id:'vitamin_d_ug',  label:'Vitamin D',   unit:'µg', group:'Vitamins' },
  { id:'vitamin_e_mg',  label:'Vitamin E',   unit:'mg', group:'Vitamins' },
  { id:'vitamin_k_ug',  label:'Vitamin K',   unit:'µg', group:'Vitamins' },
  { id:'thiamin_mg',    label:'Thiamin (B1)',unit:'mg', group:'Vitamins' },
  { id:'riboflavin_mg', label:'Riboflavin (B2)', unit:'mg', group:'Vitamins' },
  { id:'niacin_mg',     label:'Niacin (B3)', unit:'mg', group:'Vitamins' },
  { id:'vitamin_b6_mg', label:'Vitamin B6',  unit:'mg', group:'Vitamins' },
  { id:'folate_ug',     label:'Folate',      unit:'µg', group:'Vitamins' },
  { id:'vitamin_b12_ug',label:'Vitamin B12', unit:'µg', group:'Vitamins' },
  { id:'choline_mg',    label:'Choline',     unit:'mg', group:'Other' },
]

export const NUTRIENT_IDS = NUTRIENTS.map(n => n.id)

const round = (value, places = 2) => {
  const p = 10 ** places
  return Math.round((+value || 0) * p) / p
}

export function emptyNutrition() {
  return Object.fromEntries(NUTRIENT_IDS.map(id => [id, 0]))
}

export function scaleMicros(micros = {}, factor = 1) {
  return Object.fromEntries(Object.entries(micros).map(([id, value]) => [id, round(value * factor)]))
}

export function addMicros(a = {}, b = {}) {
  const result = { ...a }
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    result[id] = round((+a[id] || 0) + (+b[id] || 0))
  }
  return result
}

/* Aggregate only known values. Missing nutrients are tracked separately so a
 * partially populated food database never falsely reports zero intake. */
export function aggregateMicros(items = []) {
  const totals = {}
  const known = new Set()
  for (const item of items) {
    if (!item?.micros) continue
    for (const [id, value] of Object.entries(item.micros)) {
      totals[id] = round((totals[id] || 0) + (+value || 0))
      known.add(id)
    }
  }
  return { totals, known: [...known], missing: NUTRIENT_IDS.filter(id => !known.has(id)) }
}

export function aggregateMealNutrition(meals = []) {
  const knownItems = meals.filter(m => m?.micros)
  const result = aggregateMicros(knownItems)
  return {
    micros: result.totals,
    known: result.known,
    missing: result.missing,
    coverage: NUTRIENT_IDS.length ? result.known.length / NUTRIENT_IDS.length : 0,
  }
}

export function compareMicros(totals = {}, targets = {}) {
  return NUTRIENTS.map(n => {
    const target = +targets[n.id] || 0
    const consumed = totals[n.id]
    const known = consumed != null
    const pct = known && target > 0 ? round((consumed / target) * 100, 1) : null
    return {
      ...n,
      consumed: known ? round(consumed) : null,
      target: target || null,
      percentage: pct,
      status: !known || !target ? 'unknown' : pct < 50 ? 'very_low' : pct < 80 ? 'low' : pct <= 120 ? 'adequate' : 'high',
    }
  })
}
