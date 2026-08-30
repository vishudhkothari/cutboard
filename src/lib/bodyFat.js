/* RFM (Woolcott & Bergman, 2018) was developed and validated against DXA
 * using height, waist and sex. Other circumferences are retained as useful
 * progress measurements, but are not forced into an unvalidated equation. */
export function estimateRFM({ heightCm, waistIn, sex } = {}) {
  const height = +heightCm, waist = +waistIn * 2.54
  if (!(height > 0) || !(waist > 0)) return null
  return Math.round((64 - (20 * height / waist) + (sex === 'female' ? 12 : 0)) * 10) / 10
}

export const BODY_MEASUREMENTS = [
  { key:'leftArmIn', label:'Left arm', hint:'mid-upper arm' },
  { key:'rightArmIn', label:'Right arm', hint:'mid-upper arm' },
  { key:'leftForearmIn', label:'Left forearm', hint:'largest point' },
  { key:'rightForearmIn', label:'Right forearm', hint:'largest point' },
  { key:'waistIn', label:'Waist', hint:'same landmark' },
  { key:'neckIn', label:'Neck', hint:'below larynx' },
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
