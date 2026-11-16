import { useEffect, useMemo, useRef, useState } from 'react'
import { C, F, card } from './lib/theme'
import { Icon } from './lib/icons'
import { calendarYear, consistencyDay, consistencyHistory, consistencyStats, HABITS, habitHasData, habitMet } from './lib/consistency'
import { shiftDay, today } from './lib/planEngine'
import './ConsistencyHeatmap.css'

const FILTERS = [{ key: 'all', label: 'All habits', icon: 'calendar' }, { key: 'diet', label: 'Diet', icon: 'apple' }, { key: 'steps', label: 'Steps', icon: 'steps' }, { key: 'sleep', label: 'Sleep', icon: 'moon' }]
const STATUS = { met: 'Target met', missed: 'Not met', missing: 'Not logged', pending: 'Not finished', review: 'Needs review', unknown: 'No target' }
const fullDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const shortDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const monthName = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { month: 'short' })
const number = value => value == null ? '—' : Math.round(value).toLocaleString('en-IN')

export default function ConsistencyHeatmap({ logs, setup, cutIntel, workoutHistory, currentPlan, asOfDate = today(), onOpenDate }) {
  const currentYear = +asOfDate.slice(0, 4)
  const startDate = setup.startDate
  const firstYear = Math.min(currentYear, +startDate.slice(0, 4))
  const [year, setYear] = useState(currentYear)
  const [habit, setHabit] = useState('all')
  const [selected, setSelected] = useState(asOfDate)
  const scrollRef = useRef(null)
  const days = useMemo(() => consistencyHistory({ logs, setup, cutIntel, workoutHistory, currentPlan, asOfDate }), [logs, setup, cutIntel, workoutHistory, currentPlan, asOfDate])
  const byDate = useMemo(() => new Map(days.map(day => [day.date, day])), [days])
  const dates = useMemo(() => calendarYear(year), [year])
  const weeks = dates.length / 7
  const visibleDays = days.filter(day => +day.date.slice(0, 4) === year)
  const metDays = visibleDays.filter(day => habitMet(day, habit)).length
  const stats = consistencyStats(days, habit, asOfDate)
  const lastDate = year === currentYear ? asOfDate : `${year}-12-31`
  const selectedDate = +selected.slice(0, 4) === year && selected >= startDate ? selected : lastDate
  const selectedDay = byDate.get(selectedDate) || { ...consistencyDay(null), date: selectedDate }
  const selectedLabel = FILTERS.find(filter => filter.key === habit).label

  useEffect(() => {
    const cell = scrollRef.current?.querySelector(`[data-date="${year === currentYear ? asOfDate : `${year}-12-31`}"]`)
    if (cell && scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, cell.offsetLeft - scrollRef.current.clientWidth + 50)
  }, [year, currentYear, asOfDate])

  const moveFocus = (event, date) => {
    const offsets = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }
    const next = event.key === 'Home' ? (startDate > `${year}-01-01` ? startDate : `${year}-01-01`)
      : event.key === 'End' ? lastDate : offsets[event.key] ? shiftDay(date, offsets[event.key]) : null
    if (!next) return
    event.preventDefault()
    const cell = scrollRef.current?.querySelector(`[data-date="${next}"]`)
    if (cell && !cell.disabled) { setSelected(next); cell.focus({ preventScroll: true }); cell.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
  }

  return <section className="consistency" aria-labelledby="consistency-title" style={card({ fontFamily: F.body })}>
    <div className="consistency-header">
      <div>
        <h2 id="consistency-title" style={{ fontFamily: F.head }}><Icon name="calendar" size={18} color={C.accent} />Consistency</h2>
        <p>Small daily wins add up. Keep showing up.</p>
      </div>
      <label className="consistency-year">Year<select aria-label="Consistency year" value={year} onChange={event => setYear(+event.target.value)}>
        {Array.from({ length: currentYear - firstYear + 1 }, (_, index) => currentYear - index).map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
    </div>

    <div className="consistency-filters" role="group" aria-label="Heatmap habit">
      {FILTERS.map(filter => <button key={filter.key} type="button" aria-pressed={habit === filter.key} onClick={() => setHabit(filter.key)}>
        <Icon name={filter.icon} size={13} />{filter.label}
      </button>)}
    </div>

    <div className="consistency-stats">
      <div><strong>{metDays}<span> / {visibleDays.length}</span></strong><span>{habit === 'all' ? 'Days with all 3' : 'Days on target'} · {year}</span></div>
      <div><strong>{stats.current}<span> {stats.current === 1 ? 'day' : 'days'}</span></strong><span><Icon name="flame" size={12} color={C.orange} />Current streak</span></div>
      <div><strong>{stats.best}<span> {stats.best === 1 ? 'day' : 'days'}</span></strong><span>Best streak</span></div>
    </div>

    <div className="consistency-calendar" aria-label={`${year} ${selectedLabel.toLowerCase()} heatmap`}>
      <div className="consistency-weekdays" aria-hidden="true">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{['Mon', 'Wed', 'Fri'].includes(day) ? day : ''}</span>)}</div>
      <div className="consistency-scroll" ref={scrollRef}>
        <div className="consistency-map" style={{ '--weeks': weeks }}>
          <div className="consistency-months" aria-hidden="true">{dates.map((date, index) => date.startsWith(String(year)) && date.endsWith('-01')
            ? <span key={date} style={{ gridColumn: Math.floor(index / 7) + 1 }}>{monthName(date)}</span> : null)}</div>
          <div className="consistency-grid">
            {dates.map(date => {
              const day = byDate.get(date)
              const inYear = date.startsWith(String(year))
              const eligible = inYear && date >= startDate && date <= asOfDate
              const hasData = habitHasData(day, habit)
              const level = !hasData ? 'empty' : habit === 'all' ? day.score : habitMet(day, habit) ? 3 : 0
              const summary = !eligible ? date > asOfDate ? 'Future date' : 'Before tracking started'
                : !hasData ? 'No log' : habit === 'all' ? `${day.score} of 3 targets met`
                : `${selectedLabel}: ${STATUS[day.habits[habit].status]}`
              const label = `${fullDate(date)}: ${summary}`
              return <button key={date} type="button" data-date={date} data-level={level} data-today={date === asOfDate || undefined}
                className="consistency-cell" disabled={!eligible} style={{ visibility: inYear ? 'visible' : 'hidden' }}
                aria-label={label} title={label} aria-pressed={date === selectedDate} tabIndex={date === selectedDate ? 0 : -1}
                onClick={() => setSelected(date)} onFocus={() => setSelected(date)} onKeyDown={event => moveFocus(event, date)} />
            })}
          </div>
        </div>
      </div>
    </div>
    <div className="consistency-legend-row">
      <span className="consistency-swipe">Swipe to explore the year</span>
      <div className="consistency-legend" aria-label="Heatmap colour key">
        <span className="consistency-key" data-level="empty" />No log
        {(habit === 'all' ? [0, 1, 2, 3] : [0, 3]).map(level => <span className="consistency-legend-item" key={level}><span className="consistency-key" data-level={level} />{habit === 'all' ? `${level}/3` : level === 3 ? 'Met' : 'Not met yet'}</span>)}
      </div>
    </div>

    <div className="consistency-detail" aria-live="polite" aria-atomic="true">
      <div className="consistency-detail-header"><strong>{fullDate(selectedDate)}{selectedDate === asOfDate ? ' · Today' : ''}</strong><span>{selectedDay.score}/3 targets met</span></div>
      <div className="consistency-habits">
        {HABITS.map(key => {
          const item = selectedDay.habits[key], filter = FILTERS.find(filter => filter.key === key)
          const status = key === 'diet' && item.status === 'missed' ? 'Outside target' : item.status === 'pending' ? key === 'diet' ? 'Finish food log' : 'Confirm final steps' : STATUS[item.status]
          const value = key === 'diet' ? `${number(item.value)} / ${number(item.target)} kcal`
            : key === 'steps' ? `${number(item.value)} / ${number(item.target)} steps` : `${item.value ?? '—'} / ${item.target} hrs`
          return <div key={key} className="consistency-habit"><div><Icon name={filter.icon} size={14} color={C.textSub} /><strong>{filter.label}</strong><span className={`consistency-status ${item.status === 'met' ? 'is-met' : ''}`}>{item.status === 'met' && <Icon name="check" size={12} />}{status}</span></div><span className="consistency-value">{value}</span></div>
        })}
      </div>
      {selectedDay.estimatedTargets && <p className="consistency-target-note">Some goals weren’t saved for this date. Those targets use your current plan.</p>}
      {onOpenDate && <button type="button" className="consistency-open" onClick={() => onOpenDate(selectedDate)}>Open {selectedDate === asOfDate ? 'today’s log' : `${shortDate(selectedDate)} log`}<Icon name="arrowRight" size={13} /></button>}
    </div>
    <details className="consistency-rules"><summary>How days count</summary><p>Diet: mark the whole food log complete and finish within 5% of the day’s calorie target (at least 75 kcal either side). Steps: confirm the final count and reach the day’s goal. Sleep: log at least 7 hours. Brighter squares mean more targets met.</p><p>Missing or unfinished logs don’t earn a target. Streaks span all tracked days, and today stays open until tomorrow. Where a past goal wasn’t saved, the comparison uses your current plan.</p></details>
  </section>
}
