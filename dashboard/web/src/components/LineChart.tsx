// Tiny responsive SVG line chart with a hover crosshair, used for the
// borough speed series and the link sparkline.
import { useState, type ReactNode } from 'react'

export interface ChartPoint { t: number; v: number }

interface Props {
  points: ChartPoint[]
  yMax: number
  height: number
  color?: string
  reference?: number // dashed horizontal line, e.g. the free-flow speed
  tooltip: (p: ChartPoint) => ReactNode
  label: string
}

const W = 300 // viewBox width; the SVG stretches to its container

export function LineChart({ points, yMax, height, color = 'var(--ink-2)', reference, tooltip, label }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  if (points.length < 2) return <div className="chart chart--empty" style={{ height }}>Waiting for more windows</div>

  const t0 = points[0].t
  const span = points[points.length - 1].t - t0 || 1
  const x = (t: number) => ((t - t0) / span) * W
  const y = (v: number) => height - 2 - (Math.min(v, yMax) / yMax) * (height - 4)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const area = `${path} L${W},${height} L0,${height} Z`

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const t = t0 + ((e.clientX - rect.left) / rect.width) * span
    let best = 0
    points.forEach((p, i) => { if (Math.abs(p.t - t) < Math.abs(points[best].t - t)) best = i })
    setHover(best)
  }

  const hp = hover !== null ? points[hover] : null
  return (
    <div className="chart" style={{ height }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {reference !== undefined && (
          <line className="chart__ref" x1={0} x2={W} y1={y(reference)} y2={y(reference)} vectorEffect="non-scaling-stroke" />
        )}
        <path d={area} fill={color} opacity={0.08} />
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hp && (
          <line className="chart__cross" x1={x(hp.t)} x2={x(hp.t)} y1={0} y2={height} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {hp && (
        <>
          <span className="chart__dot" style={{ left: `${(x(hp.t) / W) * 100}%`, top: y(hp.v), background: color }} />
          <div className="chart__tip" style={{ left: `${(x(hp.t) / W) * 100}%` }}>{tooltip(hp)}</div>
        </>
      )}
    </div>
  )
}
