/* ═══════════════════════════════════════════════════════════════
   ICON SET — one consistent line-icon system to replace the emoji.
   New file: lib/icons.jsx

   Usage:
     import { Icon } from './lib/icons'
     <Icon name="flame" size={14} color={C.orange} />
     <Icon name="gear" size={18} color={C.textSub} />

   All icons are 24×24 stroke paths, currentColor by default, so they
   inherit text color unless you pass `color`. strokeWidth defaults to
   1.7 (use ~2 for small/bold contexts).
═══════════════════════════════════════════════════════════════ */
import React from 'react'

const P = {
  flame:    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
  gear:     <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  chevronLeft:  <path d="M15 18l-6-6 6-6" />,
  chevronRight: <path d="M9 18l6-6-6-6" />,
  arrowRight:   <path d="M5 12h14M13 6l6 6-6 6" />,
  sparkle:  <><path d="M12 3l1.4 4.3L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4z" /><path d="M19 14.5l.7 2.1 2.1.7-2.1.7L19 20l-.7-2-2.1-.7 2.1-.7z" /></>,
  scale:    <path d="M12 3v18M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l3 6a3 3 0 0 1-6 0zM7 21h10" />,
  moon:     <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  steps:    <><path d="M4 16v-2.4C4 11.5 3 10.5 3 8c0-2.7 1.5-6 4.5-6C9.4 2 10 3.8 10 5.5c0 3.1-2 5.7-2 8.7V16a2 2 0 1 1-4 0Z" /><path d="M20 20v-2.4c0-2.1 1-3.1 1-5.6 0-2.7-1.5-6-4.5-6C14.6 6 14 7.8 14 9.5c0 3.1 2 5.7 2 8.7V20a2 2 0 1 0 4 0Z" /></>,
  plus:     <path d="M12 5v14M5 12h14" />,
  clipboard:<><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M9 12h6M9 16h4" /></>,
  apple:    <path d="M12 7c0-1.5 1-3 3-3M12 7c-2-3-6-2.3-7.5-.3C2.7 9 3 14 6 18c1.4 2 3 3 4 3 .6 0 1.2-.4 2-.4s1.4.4 2 .4c1 0 2.6-1 4-3 1.3-1.8 2-4 1.9-6" />,
  chart:    <><path d="M3 3v18h18" /><path d="M7 14l3-4 3 2 5-6" /></>,
  target:   <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  dumbbell: <><path d="M6.5 6.5l11 11" /><rect x="1.5" y="8" width="3.5" height="8" rx="1" /><rect x="19" y="8" width="3.5" height="8" rx="1" /><rect x="5" y="9.5" width="2.5" height="5" rx="1" /><rect x="16.5" y="9.5" width="2.5" height="5" rx="1" /></>,
  check:    <path d="M20 6L9 17l-5-5" />,
  camera:   <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
  trendDown:<><path d="M23 18l-9.5-9.5-5 5L1 6" /><path d="M17 18h6v-6" /></>,
  compass:  <><circle cx="12" cy="12" r="10" /><path d="M16.2 7.8l-2.9 6.4-6.4 2.9 2.9-6.4z" /></>,
  beaker:   <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />,
  edit:     <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></>,
  flag:     <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><path d="M4 22v-7" /></>,
  clock:    <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  trophy:   <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M6 4h12v5a6 6 0 0 1-12 0z" /><path d="M9 18h6M10 22h4M12 15v3" /></>,
  ban:      <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
  x:        <path d="M18 6L6 18M6 6l12 12" />,
}

export function Icon({ name, size = 20, color = 'currentColor', strokeWidth = 1.7, style }) {
  const body = P[name]
  if (!body) { if (typeof console !== 'undefined') console.warn(`<Icon> unknown name: ${name}`); return null }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0, ...style }}>
      {body}
    </svg>
  )
}

export default Icon
