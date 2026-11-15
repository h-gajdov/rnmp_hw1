// Time travel: a scrubber over one New York day at a time, with a day picker for
// everything the bridge remembers (every replayed day of the last week). The
// network speed per 5-minute window is drawn under the track so the rush hours
// are visible before you go there. Dragging, the keyboard or a preset picks a
// moment; switching the day keeps the time of day, so 08:00 on one day compares
// with 08:00 on another. "Now" (or dragging to the live end) returns to the live
// stream. Play steps forward 5 minutes at a time, across midnight if needed.
import type { KeyboardEvent } from 'react'
import { formatClock, formatDay, formatShortDay } from '../lib/format'
import { HOUR, MINUTE, nyDayStart, nyDays, nyNextDay, nyTimeOnDayOf, sameTimeOnDay } from '../lib/nyTime'
import type { NetworkPoint } from '../types'

export const STEP = 5 * MINUTE

const PRESETS = [
  { label: 'Night', title: 'Night, 03:00', hour: 3, minute: 0 },
  { label: 'AM rush', title: 'Morning rush hour, 08:00', hour: 8, minute: 0 },
  { label: 'Lunch', title: 'Lunchtime, 12:30', hour: 12, minute: 30 },
  { label: 'PM rush', title: 'Evening rush hour, 17:30', hour: 17, minute: 30 },
]

const W = 1000 // viewBox width; the SVG stretches to its container
const H = 30

interface Props {
  start: number // earliest moment the bridge can show
  end: number // where the live stream is
  series: NetworkPoint[]
  at: number | null // null = live
  loading: boolean // the past state for `at` is still being fetched
  playing: boolean
  onChange: (at: number | null) => void
  onTogglePlay: () => void
}

export function TimeBar({ start, end, series, at, loading, playing, onChange, onTogglePlay }: Props) {
  const ready = start > 0 && end - start >= STEP
  if (!ready) {
    return (
      <div className="timebar timebar--empty">
        <span>Time travel opens once the first windows arrive</span>
      </div>
    )
  }

  const first = Math.ceil(start / STEP) * STEP // earliest moment we can go to
  const pos = at ?? end
  const days = nyDays(start, end)
  const day = nyDayStart(pos)
  const dayEnd = nyNextDay(day)
  const dayIndex = days.indexOf(day)
  const isLiveDay = end < dayEnd
  const pct = (t: number) => ((t - day) / (dayEnd - day)) * 100

  // Snap to 5-minute boundaries and keep within what the bridge has; reaching the
  // live end means "back to live".
  const go = (t: number) => {
    const snapped = Math.round(t / STEP) * STEP
    if (snapped >= end) onChange(null)
    else onChange(Math.max(snapped, first))
  }
  // Dragging stays on the shown day (its right end is 23:55, not the next midnight).
  const drag = (t: number) => go(isLiveDay ? t : Math.min(t, dayEnd - STEP))

  const showDay = (target: number) => {
    const t = sameTimeOnDay(pos, target)
    if (t >= end) onChange(null)
    else onChange(Math.max(Math.round(t / STEP) * STEP, first))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const by: Record<string, number> = {
      ArrowLeft: -STEP, ArrowDown: -STEP, ArrowRight: STEP, ArrowUp: STEP, PageDown: -HOUR, PageUp: HOUR,
    }
    if (e.key in by) go(pos + by[e.key])
    else if (e.key === 'Home') go(day)
    else if (e.key === 'End') drag(dayEnd)
    else return
    e.preventDefault()
  }

  // Network speed area under the track, scaled to the shown day's own range so the
  // rush-hour dips stand out (the network average only moves ~15 mph).
  const pts = series.filter((p) => p.window_end >= day && p.window_end <= dayEnd)
  const speeds = pts.map((p) => p.avg_speed_mph)
  const lo = Math.min(...speeds) - 2
  const hi = Math.max(...speeds) + 1
  const x = (t: number) => ((t - day) / (dayEnd - day)) * W
  const y = (v: number) => H - 1 - ((v - lo) / (hi - lo || 1)) * (H - 5)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.window_end).toFixed(1)},${y(p.avg_speed_mph).toFixed(1)}`).join(' ')
  const area = pts.length > 1 ? `${line} L${x(pts[pts.length - 1].window_end).toFixed(1)},${H} L${x(pts[0].window_end).toFixed(1)},${H} Z` : ''

  const hours = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => ({ h, t: nyTimeOnDayOf(day, h, 0) }))
  const presets = PRESETS.map((p) => ({ ...p, t: nyTimeOnDayOf(day, p.hour, p.minute) }))

  return (
    <div className={`timebar${at !== null ? ' is-past' : ''}`} role="group" aria-label="Time travel">
      <div className="timebar__day">
        <button
          type="button"
          className="timebar__step"
          onClick={() => showDay(days[dayIndex - 1])}
          disabled={dayIndex <= 0}
          aria-label="Previous day, same time"
          title="Previous day, same time"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg>
        </button>
        <select
          className="timebar__select"
          value={day}
          onChange={(e) => showDay(Number(e.target.value))}
          disabled={days.length < 2}
          aria-label="Day"
        >
          {days.map((d) => <option key={d} value={d}>{formatShortDay(d)}</option>)}
        </select>
        <button
          type="button"
          className="timebar__step"
          onClick={() => showDay(days[dayIndex + 1])}
          disabled={dayIndex < 0 || dayIndex >= days.length - 1}
          aria-label="Next day, same time"
          title="Next day, same time"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
        </button>
      </div>

      <button
        type="button"
        className="timebar__btn timebar__play"
        onClick={onTogglePlay}
        aria-label={playing ? 'Pause' : at === null ? 'Play today from midnight' : 'Play from here'}
        title={playing ? 'Pause' : 'Play forward in 5-minute steps'}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          {playing ? <path d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z" /> : <path d="M5 2.8v10.4L13 8z" />}
        </svg>
      </button>

      <div className="timebar__track">
        <div className="timebar__presets">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`timebar__preset${at === p.t ? ' is-on' : ''}`}
              style={{ left: `${pct(p.t)}%` }}
              title={p.title}
              aria-label={p.title}
              disabled={p.t < first || p.t > end}
              onClick={() => onChange(p.t)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="timebar__plot">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            {hours.map(({ t }) => (
              <line key={t} className="timebar__grid" x1={x(t)} x2={x(t)} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
            ))}
            {area && <path className="timebar__area" d={area} />}
            {line && <path className="timebar__line" d={line} vectorEffect="non-scaling-stroke" />}
          </svg>
          {start > day && <div className="timebar__void" style={{ left: 0, width: `${pct(start)}%` }} />}
          {isLiveDay && <div className="timebar__void" style={{ left: `${pct(end)}%`, right: 0 }} />}
          {at !== null && (
            <div className="timebar__after" style={{ left: `${pct(pos)}%`, width: `${pct(Math.min(end, dayEnd)) - pct(pos)}%` }} />
          )}
          <div className={`timebar__thumb${loading ? ' is-loading' : ''}`} style={{ left: `${pct(pos)}%` }} />
          <input
            type="range"
            className="timebar__input"
            min={day}
            max={dayEnd}
            step={MINUTE}
            value={pos}
            onChange={(e) => drag(Number(e.target.value))}
            onKeyDown={onKeyDown}
            aria-label="Time of day"
            aria-valuetext={`${formatDay(pos)}, ${formatClock(pos)}${at === null ? ', live' : ''}`}
          />
        </div>

        <div className="timebar__hours" aria-hidden="true">
          {hours.filter(({ h }) => h % 6 === 0).map(({ h, t }) => (
            <span key={t} style={{ left: `${pct(t)}%` }} className={h === 0 ? 'is-first' : undefined}>
              {formatClock(t)}
            </span>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="timebar__btn timebar__now"
        onClick={() => onChange(null)}
        disabled={at === null}
        title="Back to the live stream"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.2v9.6L9.5 8zM10.5 3h2.2v10h-2.2z" /></svg>
        Now
      </button>
    </div>
  )
}
