// The sign band: product name and sensor coverage on the left, the lead (the
// worst open incident, the line a traffic reporter would open with) in the
// middle, the stream's event-time clock and the feed health on the right.
import type { FeedHealth } from '../hooks/useLiveFeed'
import { formatClock, formatDay, formatDuration, formatMph, prettyLinkName } from '../lib/format'
import { byWorst, INCIDENT_LABELS, SEVERITY_COLORS } from '../lib/levels'
import type { Incident } from '../types'
import { LiveStatus } from './LiveStatus'

interface Props {
  eventClock: number
  linkCount: number
  reporting: number
  health: FeedHealth
  active: Record<string, Incident>
  onSelect: (linkId: string) => void
}

export function Header({ eventClock, linkCount, reporting, health, active, onSelect }: Props) {
  const lead = Object.values(active).sort(byWorst)[0]
  const others = Object.keys(active).length - 1

  return (
    <header className="topbar">
      <div className="brand">
        <h1 className="brand__name">NYC Traffic Watch</h1>
        <p className="brand__scope">
          {linkCount ? `${reporting} of ${linkCount} DOT speed sensors reporting` : 'Connecting to the DOT speed sensors'}
        </p>
      </div>

      <div className="lead" aria-live="polite">
        {lead ? (
          <button type="button" className="lead__button" onClick={() => onSelect(lead.link_id)} title="Show this road on the map">
            <span className="lead__label">
              <span className="lead__sev" style={{ background: SEVERITY_COLORS[lead.severity] }} aria-hidden="true" />
              Worst now
            </span>
            <span className="lead__road">{prettyLinkName(lead.link_name)}</span>
            <span className="lead__facts">
              {formatMph(lead.speed_mph)}, {INCIDENT_LABELS[lead.type].toLowerCase()} for{' '}
              {formatDuration((eventClock - lead.incident_start) / 1000)}, {lead.borough}
              {others > 0 && <span className="lead__more"> and {others} more open</span>}
            </span>
          </button>
        ) : (
          <p className="lead__quiet">
            {eventClock ? 'No open incidents. Every monitored road is above half its usual speed.' : ''}
          </p>
        )}
      </div>

      <div className="topbar__end">
        <div className="clock">
          <span className="clock__time">{eventClock ? formatClock(eventClock) : '--:--'}</span>
          <span className="clock__meta">
            <span>{eventClock ? formatDay(eventClock) : 'Waiting for data'}</span>
            <span>Stream time, New York</span>
          </span>
        </div>
        <LiveStatus health={health} />
      </div>
    </header>
  )
}
