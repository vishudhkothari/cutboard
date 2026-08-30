/* US Navy/DoD circumference method (Hodgdon & Beckett). The published
 * equations use centimetres; the UI accepts inches and converts here. */
export function estimateNavy({ heightCm, waistIn, neckIn, hipIn, sex } = {}) {
  const height = +heightCm, waist = +waistIn * 2.54, neck = +neckIn * 2.54, hip = +hipIn * 2.54
  if (!(height > 0) || !(waist > 0) || !(neck > 0)) return null
  const log10 = value => Math.log(value) / Math.LN10
  const measure = sex === 'female' ? waist + hip - neck : waist - neck
  if (!(measure > 0) || (sex === 'female' && !(hip > 0))) return null
  const density = sex === 'female'
    ? 1.29579 - 0.35004 * log10(measure) + 0.22100 * log10(height)
    : 1.0324 - 0.19077 * log10(measure) + 0.15456 * log10(height)
  return Math.round((495 / density - 450) * 10) / 10
}

export const BODY_MEASUREMENTS = [
  { key:'leftArmIn', label:'Left arm', hint:'mid-upper arm' },
  { key:'rightArmIn', label:'Right arm', hint:'mid-upper arm' },
  { key:'leftForearmIn', label:'Left forearm', hint:'largest point' },
  { key:'rightForearmIn', label:'Right forearm', hint:'largest point' },
  { key:'waistIn', label:'Waist', hint:'same landmark' },
  { key:'neckIn', label:'Neck', hint:'below larynx' },
  { key:'hipIn', label:'Hip', hint:'fullest point', femaleOnly:true },
  { key:'chestIn', label:'Chest', hint:'fullest point' },
]

// Measurements from the first implementation were stored in centimetres.
// Convert them once when an older log is opened so existing entries survive.
export function normalizeMeasurements(measurements = {}) {
  const next = { ...measurements }
  BODY_MEASUREMENTS.forEach(({ key }) => {
    const legacyKey = key.replace('In', 'Cm')
    if (next[key] == null && next[legacyKey] != null) next[key] = Math.round((+next[legacyKey] / 2.54) * 10) / 10
    delete next[legacyKey]
  })
  return next
}

export function isSunday(date) { return new Date(`${date}T12:00:00`).getDay() === 0 }
