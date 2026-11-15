// The command bar: product name and scope on the left, the time bar in the
// middle, the event-time clock (live or the past moment being viewed) and the
// connection health on the right.
import type { ReactNode } from 'react'
import type { FeedHealth } from '../hooks/useLiveFeed'
import { formatClock, formatDay } from '../lib/format'
import { LiveStatus } from './LiveStatus'

interface Props {
  eventClock: number
  linkCount: number
  reporting: number
  health: FeedHealth
  past: boolean // showing a past moment instead of the live stream
  children?: ReactNode // the time bar
}

export function Header({ eventClock, linkCount, reporting, health, past, children }: Props) {
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
            {linkCount
              ? `${reporting} of ${linkCount} DOT speed sensors ${past ? 'were reporting' : 'reporting'}`
              : 'Connecting to the DOT speed sensors'}
          </p>
        </div>
      </div>

      {children}

      <div className="topbar__end">
        <div className={`clock${past ? ' clock--past' : ''}`} aria-live="off">
          <span className="clock__time">{eventClock ? formatClock(eventClock) : '--:--'}</span>
          <span className="clock__meta">
            <span>{eventClock ? formatDay(eventClock) : 'Waiting for data'}</span>
            <span>{past ? 'Looking back, New York' : 'Stream time, New York'}</span>
          </span>
        </div>
        <LiveStatus health={health} />
      </div>
    </header>
  )
}
