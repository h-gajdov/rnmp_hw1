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
  const { borough, link_id, link_name } = feature.properties

  return (
    <aside className="panel link-panel" aria-label="Selected road segment">
      <header className="link-panel__head">
        <div>
          <p className="link-panel__where">{borough}, link {link_id}</p>
          <h2 className="link-panel__name">{prettyLinkName(link_name)}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close details" title="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3 L11 11 M11 3 L3 11" /></svg>
        </button>
      </header>

      {stats && level ? (
        <>
          <div className="link-panel__now">
            <span className="link-panel__speed">{stats.avg_speed_mph.toFixed(1)}<small> mph</small></span>
            <span className="level-mark">
              <span className="swatch" style={{ background: level.color }} />{level.label}
            </span>
          </div>
          <div className="ratio-bar" aria-label={`Congestion ratio ${formatPercent(stats.congestion_ratio)}`}>
            <span style={{ width: formatPercent(stats.congestion_ratio), background: level.color }} />
          </div>
          <p className="link-panel__ratio">{formatPercent(stats.congestion_ratio)} of the {formatMph(stats.free_flow_mph)} free-flow speed</p>

          <h3 className="chart-title">Average speed per 15-min window, mph</h3>
          <LineChart
            label="Average speed per window, last two hours"
            points={history.map((p) => ({ t: p.window_end, v: p.avg_speed_mph }))}
            yMax={yMax}
            height={64}
            reference={stats.free_flow_mph}
            color="var(--ink)"
            axis
            tooltip={(p) => <><b>{formatMph(p.v)}</b> window ending {formatClock(p.t)}</>}
          />
          <p className="caption">Dashed line: free-flow speed.</p>

          <dl className="facts">
            <div><dt>Min / max</dt><dd>{stats.min_speed_mph.toFixed(1)} / {stats.max_speed_mph.toFixed(1)} mph</dd></div>
            <div><dt>Std. deviation</dt><dd>{stats.stddev_speed_mph.toFixed(1)} mph</dd></div>
            <div><dt>Travel time</dt><dd>{Math.round(stats.avg_travel_time_s)} s</dd></div>
            <div><dt>Readings</dt><dd>{stats.count} to {formatClock(stats.window_end)}</dd></div>
          </dl>
        </>
      ) : (
        <p className="empty">No window has closed for this link yet.</p>
      )}

      <h3 className="chart-title">Incident history</h3>
      {incidents.length ? (
        <ul className="mini-feed">
          {incidents.map((i) => (
            <li key={i.alert_id}>
              <IncidentIcon type={i.type} size={16} />
              <span>{INCIDENT_LABELS[i.type]}</span>
              <time>{formatClock(i.event_time)}</time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">No incidents on this link while the dashboard was watching.</p>
      )}
    </aside>
  )
}
