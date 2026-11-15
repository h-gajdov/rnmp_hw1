import { formatClock, prettyLinkName } from '../lib/format'
import { INCIDENT_LABELS } from '../lib/levels'
import type { LiveIncident } from '../state/dashboard'
import { IncidentIcon } from './IncidentIcon'

interface Props {
  incidents: LiveIncident[]
  onSelect: (linkId: string) => void
}

/** Every alert from traffic-incidents, newest on top. */
export function IncidentFeed({ incidents, onSelect }: Props) {
  return (
    <section className="block block--grow">
      <h2 className="section-title">Alert log</h2>
      {incidents.length === 0 ? (
        <p className="muted empty">Alerts from the Flink incident detector appear here as soon as they are emitted.</p>
      ) : (
        <ol className="feed">
          {incidents.map((i) => (
            <li key={i.alert_id} className={`feed__row feed__row--${i.type.toLowerCase()}${i.live ? ' is-new' : ''}`}>
              <button onClick={() => onSelect(i.link_id)}>
                <time>{formatClock(i.event_time)}</time>
                <IncidentIcon type={i.type} size={18} />
                <span className="feed__body">
                  <span className="feed__title">
                    {INCIDENT_LABELS[i.type]} <span className="muted">on {prettyLinkName(i.link_name)}</span>
                  </span>
                  <span className="feed__msg">{i.message}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
