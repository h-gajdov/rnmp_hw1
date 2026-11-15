// One small chart per borough (from traffic-borough-stats, 5-minute tumbling
// windows). All five share the same y scale so they can be compared.
import { formatClock, formatMph, formatPercent } from '../lib/format'
import type { BoroughStats } from '../types'
import { LineChart } from './LineChart'

const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']

export function BoroughStrip({ boroughs }: { boroughs: Record<string, BoroughStats[]> }) {
  const all = Object.values(boroughs).flat()
  const yMax = Math.max(40, ...all.map((w) => w.avg_speed_mph)) * 1.1

  return (
    <section className="boroughs" aria-label="Average speed per borough">
      {BOROUGHS.map((name) => {
        const series = boroughs[name] ?? []
        const last = series[series.length - 1]
        return (
          <article key={name} className="borough">
            <header className="borough__head">
              <h3>{name}</h3>
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
              height={54}
              tooltip={(p) => {
                const w = series.find((s) => s.window_end === p.t)!
                return (
                  <>
                    <b>{formatMph(p.v)}</b> at {formatClock(p.t)}, {formatPercent(w.slow_share)} slow
                  </>
                )
              }}
            />
            <p className="borough__foot muted">
              {last
                ? <>{formatPercent(last.slow_share)} of {last.readings} readings under 15 mph</>
                : 'Waiting for the first window'}
            </p>
          </article>
        )
      })}
    </section>
  )
}
