import { INCIDENT_LABELS, levelInfo } from '../lib/levels'
import { formatMph, formatPercent, prettyLinkName } from '../lib/format'
import type { Incident, LinkFeature, LinkStats } from '../types'

interface Props {
  x: number
  y: number
  feature: LinkFeature
  stats?: LinkStats
  incident?: Incident
}

export function LinkTooltip({ x, y, feature, stats, incident }: Props) {
  const level = stats && levelInfo(stats.level)
  return (
    <div className="tooltip" style={{ left: x, top: y }} role="tooltip">
      <div className="tooltip__name">{prettyLinkName(feature.properties.link_name)}</div>
      <div className="tooltip__borough">{feature.properties.borough}</div>
      {stats && level ? (
        <div className="tooltip__row">
          <span className="swatch" style={{ background: level.color }} />
          <span>{level.label}</span>
          <span className="tooltip__value">{formatMph(stats.avg_speed_mph)}</span>
          <span className="muted">{formatPercent(stats.congestion_ratio)} of free flow</span>
        </div>
      ) : (
        <div className="tooltip__row muted">Waiting for the first window</div>
      )}
      {incident && <div className="tooltip__incident">{INCIDENT_LABELS[incident.type]}</div>}
    </div>
  )
}
