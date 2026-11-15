import { formatMph, formatPercent, prettyLinkName } from '../lib/format'
import { INCIDENT_LABELS, levelInfo } from '../lib/levels'
import type { Incident, LinkFeature, LinkStats } from '../types'
import { IncidentIcon } from './IncidentIcon'

interface Props {
  x: number
  y: number
  feature: LinkFeature
  stats?: LinkStats
  incident?: Incident
  flip?: boolean // open to the left of the cursor (near the right edge)
}

export function LinkTooltip({ x, y, feature, stats, incident, flip }: Props) {
  const level = stats && levelInfo(stats.level)
  return (
    <div className={`tooltip${flip ? ' tooltip--flip' : ''}`} style={{ left: x, top: y }} role="tooltip">
      <div className="tooltip__where">{feature.properties.borough}</div>
      <div className="tooltip__name">{prettyLinkName(feature.properties.link_name)}</div>
      {stats && level ? (
        <div className="tooltip__row">
          <span className="tooltip__value">{formatMph(stats.avg_speed_mph)}</span>
          <span className="swatch" style={{ background: level.color }} />
          <span>{level.label}, {formatPercent(stats.congestion_ratio)} of free flow</span>
        </div>
      ) : (
        <div className="tooltip__row tooltip__row--muted">Waiting for the first window</div>
      )}
      {incident && (
        <div className="tooltip__incident">
          <IncidentIcon type={incident.type} size={14} />
          {INCIDENT_LABELS[incident.type]}
        </div>
      )}
    </div>
  )
}
