import { formatClock, prettyLinkName } from '../lib/format'
import { INCIDENT_LABELS } from '../lib/levels'
import type { LiveIncident } from '../state/dashboard'
import type { IncidentType } from '../types'
import { FocusChip } from './FocusChip'
import { IncidentCounters } from './IncidentCounters'
import { IncidentIcon } from './IncidentIcon'

interface Props {
  incidents: LiveIncident[]
  counts: Record<IncidentType, number>
  focus: string | null
  onClearFocus: () => void
  onSelect: (linkId: string) => void
}

/** Every alert from traffic-incidents, newest on top, under the per-type totals. */
export function IncidentFeed({ incidents, counts, focus, onClearFocus, onSelect }: Props) {
  const list = focus === null ? incidents : incidents.filter((i) => i.borough === focus)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return (
    <section className="block block--grow" aria-labelledby="log-title">
      <header className="block__head">
        <h2 className="block__title" id="log-title">
          Alert log <span className="count">{total} since the bridge started</span>
        </h2>
        {focus && <FocusChip borough={focus} onClear={onClearFocus} />}
      </header>
      <IncidentCounters counts={counts} />
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
              <button type="button" onClick={() => onSelect(i.link_id)}>
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
