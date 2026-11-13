import { useEffect, useRef, useState } from 'react'

// Keep the editing string intact (including a trailing decimal point). Commit
// after a pause or when editing finishes, rather than on every keystroke.
export default function LogNumberInput({ value, onCommit, ...props }) {
  const [draft, setDraft] = useState(String(value ?? ''))
  const editing = useRef(false)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  useEffect(() => {
    if (!editing.current) setDraft(String(value ?? ''))
  }, [value])
  useEffect(() => {
    if (!editing.current || draft.endsWith('.')) return
    const next = draft === '' ? null : Number(draft)
    if (next === value || (next !== null && !Number.isFinite(next))) return
    const timer = setTimeout(() => commitRef.current(next), 500)
    return () => clearTimeout(timer)
  }, [draft, value])
  useEffect(() => {
    const flush = () => {
      if (!editing.current) return
      const next = draft === '' ? null : Number(draft)
      if (next !== value && (next === null || Number.isFinite(next))) commitRef.current(next)
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [draft, value])
  const commit = () => {
    editing.current = false
    const next = draft.trim() === '' ? null : Number(draft)
    if (Number.isFinite(next) || next === null) {
      if (next !== value) onCommit(next)
    }
  }
  return <input {...props} type="text" inputMode="decimal" value={draft}
    onFocus={() => { editing.current = true }}
    onChange={event => {
      const text = event.target.value
      if (/^\d*(?:[.,]\d*)?$/.test(text)) setDraft(text.replace(',', '.'))
    }}
    onBlur={commit}
    onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur()
      if (event.key === 'Escape') {
        editing.current = false
        setDraft(String(value ?? ''))
      }
    }} />
}
