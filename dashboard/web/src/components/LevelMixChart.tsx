// Stacked bars: for every link-stats window, the share of reporting road
// segments at each congestion level (free flow at the bottom, severe on top).
import { useState } from 'react'
import { formatClock } from '../lib/format'
import { LEVELS } from '../lib/levels'
import type { LevelMix } from '../lib/network'

const ORDER = [...LEVELS].reverse() // SEVERE ... FREE, drawn top to bottom

export function LevelMixChart({ mixes, height }: { mixes: LevelMix[]; height: number }) {
  const [hover, setHover] = useState<number | null>(null)
  if (mixes.length < 2) return <div className="chart chart--empty" style={{ height: height + 18 }}>Waiting for more windows</div>

  const hm = hover !== null ? mixes[hover] : null
  const pct = (i: number) => `${((i + 0.5) / mixes.length) * 100}%`
  return (
    <div className="chart chart--ticks">
      <div
        className="mix"
        style={{ height }}
        role="img"
        aria-label="Share of road segments at each congestion level per window"
        onPointerLeave={() => setHover(null)}
      >
        {mixes.map((m, i) => (
          <div key={m.t} className={`mix__bar${hover === i ? ' is-hover' : ''}`} onPointerEnter={() => setHover(i)}>
            {ORDER.map((l) => m.counts[l.level] > 0 && (
              <span key={l.level} style={{ flexGrow: m.counts[l.level], background: l.color }} />
            ))}
          </div>
        ))}
        {hm && (
          <div
            className={`chart__tip chart__tip--table${hover! > mixes.length * 0.6 ? ' chart__tip--left' : hover! < mixes.length * 0.4 ? ' chart__tip--right' : ''}`}
            style={{ left: pct(hover!) }}
          >
            <div className="chart__tip-head">Window ending {formatClock(hm.t)}</div>
            {LEVELS.map((l) => (
              <div key={l.level} className="chart__tip-row">
                <span className="swatch" style={{ background: l.color }} />
                <span>{l.label}</span>
                <b>{Math.round((hm.counts[l.level] / hm.total) * 100)}%</b>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="chart__axis" aria-hidden="true">
        <span>{formatClock(mixes[0].t)}</span>
        <span>{formatClock(mixes[mixes.length - 1].t)}</span>
      </div>
    </div>
  )
}
