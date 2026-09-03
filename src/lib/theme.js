/* ═══════════════════════════════════════════════════════════════
   DESIGN SYSTEM — single source of truth for every tab.
   Drop-in replacement for lib/theme.js.

   WHAT CHANGED vs the old file:
   • Muted the six semantic colors (same KEYS, softer VALUES) so they
     stop competing with the purple accent. Every existing C.orange /
     C.blue / C.red … reference softens automatically — no edits needed.
   • Added explicit macro tokens (C.protein / C.carbs / C.fat / C.fiber)
     and status aliases (C.good / C.warn / C.bad / C.info). Point the
     macro bars at these so "Fat" stops sharing the accent purple.
   • Lifted textSub / textFaint for WCAG-safe contrast.
   • F.mono → JetBrains Mono (cleaner, tabular numerals).
   • Added RADIUS / BAR tokens to kill the 3/4/5px bar drift.
═══════════════════════════════════════════════════════════════ */
import { useState, useEffect } from 'react'

export const C = {
  bg:'#0a0a0c', surface:'#141417', surfaceAlt:'#1b1b20', border:'#26262d', borderSoft:'#1e1e24',

  // ── identity (unchanged) ──
  accent:'#a78bfa', accentDim:'#8b6df0', accentGlow:'#7c5cf5',

  // ── text (lifted for contrast) ──
  text:'#f4f4f6', textSub:'#9a9aa2', textFaint:'#5c5c64',

  // ── semantic set: SAME KEYS as before, muted values ──
  // every old reference (steps, streak, sleep, alerts…) softens for free
  red:'#d8748c', orange:'#d6a06b', blue:'#6f97bd', purple:'#a78bfa', gold:'#d6a45c', teal:'#5fb89a',
  darkGreen:'#2f7d4a', green:'#5fb89a',

  // ── explicit macro tokens (use these on the macro bars) ──
  protein:'#d6a06b', carbs:'#6f97bd', fat:'#c98f93', fiber:'#6fb09c',

  // ── status aliases (coach dots, verdicts) ──
  good:'#5fb89a', warn:'#d6a45c', bad:'#d8748c', info:'#6f97bd',
}

export const F = { head:"'Syne', sans-serif", mono:"'JetBrains Mono', monospace", body:"'DM Sans', sans-serif" }

export const SHADOW = '0 1px 2px rgba(0,0,0,0.5), 0 10px 30px -14px rgba(0,0,0,0.6)'
export const GLOW   = c => `0 0 0 1px ${c}30, 0 6px 24px -8px ${c}50`

// standardized scale — reach for these instead of magic numbers
export const RADIUS = { hero:22, card:18, inset:12, pill:20 }
export const BAR    = { track:'#1e1e24', h:6 }   // progress-bar height & track

export const card = (x = {}) => ({
  background: `linear-gradient(165deg, ${C.surface} 0%, #101013 100%)`,
  border: `1px solid ${C.border}`, borderRadius: RADIUS.card, padding: '18px 20px',
  boxShadow: SHADOW,
  minWidth: 0,   // grid/flex children default to min-width:auto and overflow the viewport
  ...x,
})

export const btn = (active = false, sm = false) => ({
  background: active ? `linear-gradient(135deg, ${C.accent}, ${C.accentDim})` : 'rgba(255,255,255,0.025)',
  color: active ? '#150a26' : C.text,
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
  minWidth: 0,
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
