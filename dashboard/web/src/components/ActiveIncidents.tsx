import { formatDurationShort, prettyLinkName } from '../lib/format'
import { byWorst, INCIDENT_LABELS, SEVERITY_COLORS } from '../lib/levels'
import type { Incident } from '../types'
import { FocusChip } from './FocusChip'

interface Props {
  active: Record<string, Incident>
  eventClock: number
  focus: string | null
  onClearFocus: () => void
  onSelect: (linkId: string) => void
}

/** Incidents that have opened but not recovered yet, worst first, in fixed
 *  columns so a row can change in place without the list jumping around. */
export function ActiveIncidents({ active, eventClock, focus, onClearFocus, onSelect }: Props) {
  const list = Object.values(active)
    .filter((i) => focus === null || i.borough === focus)
    .sort(byWorst)
  return (
    <section className="block block--open" aria-labelledby="open-title">
      <header className="block__head">
        <h2 className="block__title" id="open-title">
          Open incidents <span className="count">{list.length}</span>
        </h2>
        {focus && <FocusChip borough={focus} onClear={onClearFocus} />}
      </header>
      {list.length === 0 ? (
        <p className="empty">
          {focus ? `No open incidents in ${focus}.` : 'No open incidents. Every monitored road is above half its usual speed.'}
        </p>
      ) : (
        <div className="rundown">
          <div className="rundown__row rundown__row--head" aria-hidden="true">
            <span />
            <span>Road, worst first</span>
            <span className="rundown__num">mph</span>
            <span className="rundown__num">Open</span>
          </div>
          <ul className="rundown__body" aria-label="Open incidents, worst first">
            {list.map((i) => (
              <li key={i.link_id}>
                <button type="button" className="rundown__row" onClick={() => onSelect(i.link_id)}>
                  <span className="sev-mark" style={{ background: SEVERITY_COLORS[i.severity] }} aria-hidden="true" />
                  <span className="rundown__road">
                    <span className="rundown__name">{prettyLinkName(i.link_name)}</span>
                    <span className="rundown__meta">
                      <b>{i.severity[0] + i.severity.slice(1).toLowerCase()}</b> {INCIDENT_LABELS[i.type].toLowerCase()}, {i.borough}
                    </span>
                  </span>
                  <span className="rundown__num rundown__speed">{i.speed_mph.toFixed(1)}<span className="sr-only"> mph</span></span>
                  <span className="rundown__num rundown__open">
                    <span className="sr-only">open for </span>{formatDurationShort((eventClock - i.incident_start) / 1000)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
