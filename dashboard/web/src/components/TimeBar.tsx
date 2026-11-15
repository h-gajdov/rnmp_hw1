// Time travel: a scrubber over everything the bridge remembers (normally the
// whole replayed day). The network speed per 5-minute window is drawn under the
// track so the rush hours are visible before you go there. Dragging, the
// keyboard or a preset picks a past moment; "Now" (or dragging to the right end)
// returns to the live stream. Play steps through the day 5 minutes at a time.
import type { KeyboardEvent } from 'react'
import { formatClock, formatDay } from '../lib/format'
import { HOUR, MINUTE, latestOccurrence, nyHour } from '../lib/nyTime'
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

  const span = end - start
  const pos = at ?? end
  const pct = (t: number) => ((t - start) / span) * 100

  // Snap to 5-minute boundaries; the right end means "back to live".
  const go = (t: number) => {
    const snapped = Math.round(t / STEP) * STEP
    if (snapped >= end) onChange(null)
    else onChange(Math.max(snapped, Math.ceil(start / STEP) * STEP))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const by: Record<string, number> = {
      ArrowLeft: -STEP, ArrowDown: -STEP, ArrowRight: STEP, ArrowUp: STEP, PageDown: -HOUR, PageUp: HOUR,
    }
    if (e.key in by) go(pos + by[e.key])
    else if (e.key === 'Home') go(start)
    else if (e.key === 'End') onChange(null)
    else return
    e.preventDefault()
  }

  // Network speed area under the track, scaled to the day's own range so the
  // rush-hour dips stand out (the network average only moves ~15 mph).
  const pts = series.filter((p) => p.window_end >= start && p.window_end <= end)
  const speeds = pts.map((p) => p.avg_speed_mph)
  const lo = Math.min(...speeds) - 2
  const hi = Math.max(...speeds) + 1
  const x = (t: number) => ((t - start) / span) * W
  const y = (v: number) => H - 1 - ((v - lo) / (hi - lo || 1)) * (H - 5)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.window_end).toFixed(1)},${y(p.avg_speed_mph).toFixed(1)}`).join(' ')
  const area = pts.length > 1 ? `${line} L${x(pts[pts.length - 1].window_end).toFixed(1)},${H} L${x(pts[0].window_end).toFixed(1)},${H} Z` : ''

  // Hour marks: every 3 hours a hairline, every 6 hours a label.
  const hours: number[] = []
  // The first label falls on the range start when that is (about) a 6-hour mark, e.g. 00:00:06.
  for (let t = Math.round(start / HOUR) * HOUR; t <= end; t += HOUR) if (nyHour(t) % 3 === 0) hours.push(t)

  const presets = PRESETS.map((p) => ({ ...p, t: latestOccurrence(end, p.hour, p.minute) }))
    .filter((p) => p.t >= start)

  return (
    <div className={`timebar${at !== null ? ' is-past' : ''}`} role="group" aria-label="Time travel">
      <button
        type="button"
        className="timebar__btn timebar__play"
        onClick={onTogglePlay}
        aria-label={playing ? 'Pause' : at === null ? 'Play the day from the start' : 'Play from here'}
        title={playing ? 'Pause' : 'Play through the day'}
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
              onClick={() => onChange(p.t)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="timebar__plot">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            {hours.map((t) => (
              <line key={t} className="timebar__grid" x1={x(t)} x2={x(t)} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
            ))}
            {area && <path className="timebar__area" d={area} />}
            {line && <path className="timebar__line" d={line} vectorEffect="non-scaling-stroke" />}
          </svg>
          {at !== null && <div className="timebar__after" style={{ left: `${pct(pos)}%` }} />}
          <div className={`timebar__thumb${loading ? ' is-loading' : ''}`} style={{ left: `${pct(pos)}%` }} />
          <input
            type="range"
            className="timebar__input"
            min={start}
            max={end}
            step={MINUTE}
            value={pos}
            onChange={(e) => go(Number(e.target.value))}
            onKeyDown={onKeyDown}
            aria-label="Point in time"
            aria-valuetext={`${formatDay(pos)}, ${formatClock(pos)}${at === null ? ', live' : ''}`}
          />
        </div>

        <div className="timebar__hours" aria-hidden="true">
          {hours.filter((t) => nyHour(t) % 6 === 0).map((t) => (
            <span key={t} style={{ left: `${Math.max(pct(t), 0)}%` }} className={pct(t) < 2 ? 'is-first' : undefined}>
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
