// One card per borough (from traffic-borough-stats, 5-minute tumbling
// windows). All five charts share the same y scale so they can be compared.
// Hovering a card highlights the borough on the map; clicking focuses it.
import { BOROUGHS } from '../lib/boroughs'
import { formatClock, formatMph, formatPercent } from '../lib/format'
import type { BoroughStats, Incident } from '../types'
import { LineChart } from './LineChart'

interface Props {
  boroughs: Record<string, BoroughStats[]>
  active: Record<string, Incident>
  focus: string | null
  hover: string | null
  onFocus: (borough: string | null) => void
  onHover: (borough: string | null) => void
}

export function BoroughStrip({ boroughs, active, focus, hover, onFocus, onHover }: Props) {
  const all = Object.values(boroughs).flat()
  const yMax = Math.max(40, ...all.map((w) => w.avg_speed_mph)) * 1.1
  const open = Object.values(active).reduce<Record<string, number>>((acc, i) => {
    acc[i.borough] = (acc[i.borough] ?? 0) + 1
    return acc
  }, {})

  return (
    <section className="boroughs" aria-label="Average speed per borough">
      {BOROUGHS.map((name) => {
        const series = boroughs[name] ?? []
        const last = series[series.length - 1]
        const incidents = open[name] ?? 0
        const toggle = () => onFocus(focus === name ? null : name)
        return (
          <article
            key={name}
            className={[
              'borough',
              focus === name && 'is-focus',
              focus !== null && focus !== name && 'is-dim',
              hover === name && 'is-hover',
            ].filter(Boolean).join(' ')}
            onMouseEnter={() => onHover(name)}
            onMouseLeave={() => onHover(null)}
            onClick={toggle}
          >
            <header className="borough__head">
              <button
                type="button"
                className="borough__name"
                aria-pressed={focus === name}
                onClick={(e) => { e.stopPropagation(); toggle() }}
              >
                {name}
              </button>
              {last && (
                <span className="borough__now">
                  <b>{last.avg_speed_mph.toFixed(1)}</b> mph
                </span>
              )}
            </header>
            <LineChart
              label={`${name}: average speed per 5-minute window`}
              points={series.map((w) => ({ t: w.window_end, v: w.avg_speed_mph }))}
              yMax={yMax}
              height={44}
              color="var(--ink)"
              tooltip={(p) => {
                const w = series.find((s) => s.window_end === p.t)!
                return (
                  <>
                    <b>{formatMph(p.v)}</b> at {formatClock(p.t)}, {formatPercent(w.slow_share)} slow
                  </>
                )
              }}
            />
            <footer className="borough__foot">
              <span>
                {last ? <>{formatPercent(last.slow_share)} under 15 mph, {last.links} links</> : 'Waiting for the first window'}
              </span>
              {incidents > 0 && <span className="borough__alerts">{incidents} open</span>}
            </footer>
          </article>
        )
      })}
    </section>
  )
}
