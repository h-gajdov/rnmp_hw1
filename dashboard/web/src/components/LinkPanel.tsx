import { formatClock, formatMph, formatPercent, prettyLinkName } from '../lib/format'
import { INCIDENT_LABELS, levelInfo } from '../lib/levels'
import type { Incident, LinkFeature, LinkPoint, LinkStats } from '../types'
import { IncidentIcon } from './IncidentIcon'
import { LineChart } from './LineChart'

interface Props {
  feature: LinkFeature
  stats?: LinkStats
  history: LinkPoint[]
  incidents: Incident[] // this link's recent alerts, newest first
  onClose: () => void
}

export function LinkPanel({ feature, stats, history, incidents, onClose }: Props) {
  const level = stats && levelInfo(stats.level)
  const yMax = Math.max(stats?.free_flow_mph ?? 0, ...history.map((p) => p.avg_speed_mph)) * 1.1 || 60

  return (
    <aside className="panel link-panel" aria-label="Selected road segment">
      <header className="link-panel__head">
        <div>
          <h2 className="link-panel__name">{prettyLinkName(feature.properties.link_name)}</h2>
          <p className="muted">{feature.properties.borough}, link {feature.properties.link_id}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close details">×</button>
      </header>

      {stats && level ? (
        <>
          <div className="link-panel__now">
            <span className="level-chip" style={{ '--chip': level.color } as React.CSSProperties}>{level.label}</span>
            <span className="link-panel__speed">{stats.avg_speed_mph.toFixed(1)}<small> mph</small></span>
            <span className="muted">of {formatMph(stats.free_flow_mph)} free flow</span>
          </div>
          <div className="ratio-bar" aria-label={`Congestion ratio ${formatPercent(stats.congestion_ratio)}`}>
            <span style={{ width: formatPercent(stats.congestion_ratio), background: level.color }} />
          </div>

          <LineChart
            label="Average speed per window, last two hours"
            points={history.map((p) => ({ t: p.window_end, v: p.avg_speed_mph }))}
            yMax={yMax}
            height={72}
            reference={stats.free_flow_mph}
            tooltip={(p) => <><b>{formatMph(p.v)}</b> window ending {formatClock(p.t)}</>}
          />
          <p className="caption">Average speed per 15-minute window; dashed line is the free-flow speed.</p>

          <dl className="facts">
            <div><dt>Min / max</dt><dd>{stats.min_speed_mph.toFixed(1)} / {stats.max_speed_mph.toFixed(1)} mph</dd></div>
            <div><dt>Std. deviation</dt><dd>{stats.stddev_speed_mph.toFixed(1)} mph</dd></div>
            <div><dt>Travel time</dt><dd>{Math.round(stats.avg_travel_time_s)} s</dd></div>
            <div><dt>Readings</dt><dd>{stats.count} in window to {formatClock(stats.window_end)}</dd></div>
          </dl>
        </>
      ) : (
        <p className="muted">No window has closed for this link yet.</p>
      )}

      <h3 className="section-title">Incident history</h3>
      {incidents.length ? (
        <ul className="mini-feed">
          {incidents.map((i) => (
            <li key={i.alert_id}>
              <IncidentIcon type={i.type} size={18} />
              <span>{INCIDENT_LABELS[i.type]}</span>
              <time className="muted">{formatClock(i.event_time)}</time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No incidents on this link while the dashboard was watching.</p>
      )}
    </aside>
  )
}
