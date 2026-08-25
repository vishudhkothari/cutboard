/* Practical adult reference targets. These are comparison targets for a
 * healthy adult coach, not a diagnosis or a substitute for clinical advice. */
export const NUTRIENT_TARGETS = {
  male: {
    calcium_mg:1000, iron_mg:17, magnesium_mg:340, phosphorus_mg:700,
    potassium_mg:3400, sodium_mg:2000, zinc_mg:11, copper_mg:0.9,
    selenium_ug:55, vitamin_a_ug:900, vitamin_c_mg:75, vitamin_d_ug:15,
    vitamin_e_mg:15, vitamin_k_ug:120, thiamin_mg:1.2, riboflavin_mg:1.3,
    niacin_mg:16, vitamin_b6_mg:1.3, folate_ug:400, vitamin_b12_ug:2.4,
    choline_mg:550,
  },
  female: {
    calcium_mg:1000, iron_mg:21, magnesium_mg:310, phosphorus_mg:700,
    potassium_mg:2900, sodium_mg:2000, zinc_mg:8, copper_mg:0.9,
    selenium_ug:55, vitamin_a_ug:700, vitamin_c_mg:65, vitamin_d_ug:15,
    vitamin_e_mg:15, vitamin_k_ug:90, thiamin_mg:1.1, riboflavin_mg:1.1,
    niacin_mg:14, vitamin_b6_mg:1.3, folate_ug:400, vitamin_b12_ug:2.4,
    choline_mg:425,
  },
}

export function getNutrientTargets(setup = {}) {
  const base = NUTRIENT_TARGETS[setup.sex === 'female' ? 'female' : 'male']
  return { ...base }
}
