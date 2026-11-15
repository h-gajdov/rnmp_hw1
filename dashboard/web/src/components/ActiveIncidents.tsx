import { formatDuration, formatMph, prettyLinkName } from '../lib/format'
import { INCIDENT_LABELS } from '../lib/levels'
import type { Incident, Severity } from '../types'
import { IncidentIcon } from './IncidentIcon'

const RANK: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

interface Props {
  active: Record<string, Incident>
  eventClock: number
  onSelect: (linkId: string) => void
}

/** Incidents that have opened but not recovered yet, worst first. */
export function ActiveIncidents({ active, eventClock, onSelect }: Props) {
  const list = Object.values(active).sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || a.incident_start - b.incident_start,
  )
  return (
    <section className="block">
      <h2 className="section-title">
        Open incidents <span className="count">{list.length}</span>
      </h2>
      {list.length === 0 ? (
        <p className="muted empty">No open incidents. Every monitored road is above half its usual speed.</p>
      ) : (
        <ul className="open-list">
          {list.map((i) => (
            <li key={i.link_id}>
              <button className="open-item" onClick={() => onSelect(i.link_id)}>
                <IncidentIcon type={i.type} />
                <span className="open-item__body">
                  <span className="open-item__name">{prettyLinkName(i.link_name)}</span>
                  <span className="muted">
                    {INCIDENT_LABELS[i.type]}, {i.borough}, open {formatDuration((eventClock - i.incident_start) / 1000)}
                  </span>
                </span>
                <span className="open-item__speed">
                  <b>{formatMph(i.speed_mph)}</b>
                  <span className={`sev sev--${i.severity.toLowerCase()}`}>{i.severity.toLowerCase()}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
