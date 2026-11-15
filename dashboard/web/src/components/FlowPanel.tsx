// Network-wide traffic flow: how fast the network is moving now, how that
// changed over the last hours, and how the congestion mix shifted.
import { useMemo } from 'react'
import { formatClock, formatMph, formatPercent } from '../lib/format'
import { LEVELS } from '../lib/levels'
import { levelMix, networkSeries } from '../lib/network'
import type { BoroughStats, Incident, LinkPoint, LinkStats } from '../types'
import { LevelMixChart } from './LevelMixChart'
import { LineChart } from './LineChart'

interface Props {
  boroughs: Record<string, BoroughStats[]>
  history: Record<string, LinkPoint[]>
  links: Record<string, LinkStats>
  silent: Record<string, Incident>
}

const HOUR_WINDOWS = 12 // 12 x 5-minute windows

export function FlowPanel({ boroughs, history, links, silent }: Props) {
  const series = useMemo(() => networkSeries(boroughs), [boroughs])
  const mixes = useMemo(() => levelMix(history), [history])

  const now = series[series.length - 1]
  const hourAgo = series.length > HOUR_WINDOWS ? series[series.length - 1 - HOUR_WINDOWS] : undefined
  const delta = now && hourAgo ? now.speed - hourAgo.speed : null

  const reporting = Object.values(links).filter((l) => !(l.link_id in silent))
  const free = reporting.filter((l) => l.level === 'FREE').length

  // same two hours as the congestion mix, so the two charts line up
  const shown = mixes.length ? series.filter((w) => w.t >= mixes[0].t) : series.slice(-24)
  const yMax = Math.max(40, ...shown.map((w) => w.speed)) * 1.15
  const ticks = yMax > 60 ? [20, 40, 60] : [20, 40]

  return (
    <section className="block flow" aria-labelledby="flow-title">
      <header className="block__head">
        <h2 className="block__title" id="flow-title">Network speed</h2>
        <span className="block__meta">All boroughs, per 5-minute window</span>
      </header>

      <p className="flow__now">
        <span className="flow__value">{now ? now.speed.toFixed(1) : '--'}<small> mph</small></span>
        <span className="flow__delta">
          {delta === null
            ? 'The change shows after an hour of windows'
            : Math.abs(delta) < 0.05
              ? 'Same as an hour ago'
              : `${Math.abs(delta).toFixed(1)} mph ${delta < 0 ? 'slower' : 'faster'} than an hour ago`}
        </span>
      </p>

      <LineChart
        label="Network average speed per 5-minute window"
        points={shown.map((w) => ({ t: w.t, v: w.speed }))}
        yMax={yMax}
        height={56}
        color="var(--ink)"
        ticks={ticks}
        axis
        tooltip={(p) => {
          const w = series.find((s) => s.t === p.t)!
          return <><b>{formatMph(p.v)}</b> at {formatClock(p.t)}, {w.readings} reports, {formatPercent(w.slowShare)} slow</>
        }}
      />

      <dl className="flow__facts">
        <div>
          <dt>Moving freely</dt>
          <dd><b>{reporting.length ? formatPercent(free / reporting.length) : '--'}</b> {free} of {reporting.length} segments</dd>
        </div>
        <div>
          <dt>Sensor reports</dt>
          <dd><b>{now ? now.readings : '--'}</b> in the 5 min to {now ? formatClock(now.t) : '--:--'}</dd>
        </div>
      </dl>

      <h3 className="chart-title">Congestion mix per window</h3>
      <LevelMixChart mixes={mixes} height={32} />
      <ul className="key" aria-hidden="true">
        {LEVELS.map((l) => (
          <li key={l.level}><span className="swatch" style={{ background: l.color }} />{l.label}</li>
        ))}
      </ul>
    </section>
  )
}
