// The command bar: product name and scope on the left, the stream's
// event-time clock and the connection health on the right.
import type { FeedHealth } from '../hooks/useLiveFeed'
import { formatClock, formatDay } from '../lib/format'
import { LiveStatus } from './LiveStatus'

interface Props {
  eventClock: number
  linkCount: number
  reporting: number
  health: FeedHealth
}

export function Header({ eventClock, linkCount, reporting, health }: Props) {
  return (
    <header className="topbar">
      <div className="brand">
        <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="1" y="1" width="30" height="30" rx="7" />
          <path d="M7 22 L13 14 L18 19 L25 10" />
        </svg>
        <div>
          <h1 className="brand__name">NYC Traffic Watch</h1>
          <p className="brand__scope">
            {linkCount ? `${reporting} of ${linkCount} DOT speed sensors reporting` : 'Connecting to the DOT speed sensors'}
          </p>
        </div>
      </div>

      <div className="topbar__end">
        <div className="clock" aria-live="off">
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
