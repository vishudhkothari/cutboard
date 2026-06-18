import React from 'react'
import { C, F } from './theme'

/* Catches any render/runtime error in the tree below it so a single bad
   component can't white-screen the whole app. Shows a recover button
   instead of a blank page. */
export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('App crashed:', error, info) }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:24,
        background:C.bg, color:C.text, fontFamily:F.body, textAlign:'center' }}>
        <div style={{ maxWidth:380 }}>
          <div style={{ fontFamily:F.head, fontWeight:800, fontSize:22, marginBottom:10 }}>Something broke</div>
          <div style={{ fontSize:14, color:C.textSub, lineHeight:1.55, marginBottom:20 }}>
            The app hit an unexpected error. Your data is safe — reloading usually fixes it.
          </div>
          <div style={{ fontFamily:F.mono, fontSize:11, color:C.textFaint, background:C.surface, border:`1px solid ${C.border}`,
            borderRadius:10, padding:'10px 12px', marginBottom:20, wordBreak:'break-word', textAlign:'left' }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
          <button onClick={() => window.location.reload()}
            style={{ background:`linear-gradient(135deg, ${C.accent}, ${C.accentDim})`, color:'#150a26', border:'none',
              borderRadius:12, padding:'12px 28px', fontSize:15, fontWeight:700, fontFamily:F.body, cursor:'pointer' }}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
