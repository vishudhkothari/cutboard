/* RFM (Woolcott & Bergman, 2018) was developed and validated against DXA
 * using height, waist and sex. Other circumferences are retained as useful
 * progress measurements, but are not forced into an unvalidated equation. */
export function estimateRFM({ heightCm, waistCm, sex } = {}) {
  const height = +heightCm, waist = +waistCm
  if (!(height > 0) || !(waist > 0)) return null
  return Math.round((64 - (20 * height / waist) + (sex === 'female' ? 12 : 0)) * 10) / 10
}

export const BODY_MEASUREMENTS = [
  { key:'leftArmCm', label:'Left arm', hint:'mid-upper arm' },
  { key:'rightArmCm', label:'Right arm', hint:'mid-upper arm' },
  { key:'leftForearmCm', label:'Left forearm', hint:'largest point' },
  { key:'rightForearmCm', label:'Right forearm', hint:'largest point' },
  { key:'waistCm', label:'Waist', hint:'same landmark' },
  { key:'neckCm', label:'Neck', hint:'below larynx' },
  { key:'chestCm', label:'Chest', hint:'fullest point' },
]

export function isSunday(date) { return new Date(`${date}T12:00:00`).getDay() === 0 }
