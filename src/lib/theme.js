/* ═══════════════════════════════════════════════════════════════
   DESIGN SYSTEM — single source of truth for every tab.
   Previously hand-duplicated in App.jsx / CutIQTab.jsx / WorkoutTab.jsx;
   change colors, radii or shadows HERE and the whole app follows.
═══════════════════════════════════════════════════════════════ */
import { useState, useEffect } from 'react'

export const C = {
  bg:'#0a0a0c', surface:'#141417', surfaceAlt:'#1b1b20', border:'#26262d', borderSoft:'#1e1e24',
  accent:'#a78bfa', accentDim:'#8b6df0', accentGlow:'#7c5cf5', text:'#f4f4f6', textSub:'#85858f', textFaint:'#4d4d56',
  red:'#f0566f', orange:'#f0964d', blue:'#6aa9f5', purple:'#a78bfa', gold:'#e0b94d', teal:'#4dd4c0',
}

export const F = { head:"'Syne', sans-serif", mono:"'Space Mono', monospace", body:"'DM Sans', sans-serif" }

export const SHADOW = '0 1px 2px rgba(0,0,0,0.5), 0 10px 30px -14px rgba(0,0,0,0.6)'
export const GLOW   = c => `0 0 0 1px ${c}30, 0 6px 24px -8px ${c}50`

export const card = (x = {}) => ({
  background: `linear-gradient(165deg, ${C.surface} 0%, #101013 100%)`,
  border: `1px solid ${C.border}`, borderRadius: 18, padding: '18px 20px',
  boxShadow: SHADOW,
  minWidth: 0,   // grid/flex children default to min-width:auto and overflow the viewport
  ...x,
})

export const btn = (active = false, sm = false) => ({
  background: active ? `linear-gradient(135deg, ${C.accent}, ${C.accentDim})` : 'rgba(255,255,255,0.025)',
  color: active ? '#0a0612' : C.text,
  border: `1px solid ${active ? 'transparent' : C.border}`, borderRadius: 12,
  padding: sm ? '7px 14px' : '11px 20px', cursor: 'pointer',
  fontFamily: F.body, fontSize: sm ? 13 : 14, fontWeight: active ? 700 : 500,
  transition: 'all 0.18s cubic-bezier(.4,0,.2,1)',
  boxShadow: active ? GLOW(C.accent) : 'none',
})

export const inp = (x = {}) => ({
  background: '#0c0c0f', border: `1px solid ${C.border}`, borderRadius: 12,
  padding: '11px 14px', color: C.text, fontFamily: F.body, fontSize: 14,
  width: '100%', boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.15s',
  minWidth: 0,   // <input> has a large intrinsic min width that blows out grids on mobile
  ...x,
})

export const LBL = { fontSize: 10.5, color: C.textSub, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6, display: 'block' }

export const TT = {
  contentStyle: { background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 12, fontFamily: F.body, fontSize: 12, color: C.text, boxShadow: SHADOW },
  cursor: { stroke: C.border },
}

export function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return mobile
}

/* Haptic tick — silently no-ops where unsupported (iOS Safari, desktop) */
export const buzz = (pattern = 10) => { try { navigator.vibrate?.(pattern) } catch { /* unsupported */ } }
