import { formatClock, prettyLinkName } from '../lib/format'
import { INCIDENT_LABELS } from '../lib/levels'
import type { LiveIncident } from '../state/dashboard'
import { FocusChip } from './FocusChip'
import { IncidentIcon } from './IncidentIcon'

interface Props {
  incidents: LiveIncident[]
  focus: string | null
  onClearFocus: () => void
  onSelect: (linkId: string) => void
}

/** Every alert from traffic-incidents, newest on top. */
export function IncidentFeed({ incidents, focus, onClearFocus, onSelect }: Props) {
  const list = focus === null ? incidents : incidents.filter((i) => i.borough === focus)
  return (
    <section className="block block--grow">
      <header className="block__head">
        <h2 className="block__title">Alert log</h2>
        {focus && <FocusChip borough={focus} onClear={onClearFocus} />}
      </header>
      {list.length === 0 ? (
        <p className="empty">
          {focus
            ? `No alerts from ${focus} yet.`
            : 'Alerts from the Flink incident detector appear here as soon as they are emitted.'}
        </p>
      ) : (
        <ol className="feed">
          {list.map((i) => (
            <li key={i.alert_id} className={`feed__row${i.live ? ' is-new' : ''}`}>
              <button onClick={() => onSelect(i.link_id)}>
                <time>{formatClock(i.event_time)}</time>
                <IncidentIcon type={i.type} size={16} />
                <span className="feed__body">
                  <span className="feed__title">
                    {INCIDENT_LABELS[i.type]} <span className="feed__where">{prettyLinkName(i.link_name)}, {i.borough}</span>
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
