// The header, drawn like an overhead highway guide sign: the title on the
// left, the stream's event-time clock and the connection health on the right.
import type { FeedHealth } from '../hooks/useLiveFeed'
import { formatClock, formatDay } from '../lib/format'
import { LiveStatus } from './LiveStatus'

interface Props {
  eventClock: number
  linkCount: number
  health: FeedHealth
}

export function Gantry({ eventClock, linkCount, health }: Props) {
  return (
    <header className="gantry">
      <div className="gantry__sign">
        <div className="gantry__title">
          <h1>NYC Traffic Watch</h1>
          <p>Live incident detection on {linkCount || 'the'} DOT speed sensors</p>
        </div>
        <div className="gantry__clock" aria-live="off">
          <span className="gantry__time">{eventClock ? formatClock(eventClock) : '--:--'}</span>
          <span className="gantry__day">
            {eventClock ? formatDay(eventClock) : 'Waiting for data'}
            <br />
            stream time, New York
          </span>
        </div>
      </div>
      <LiveStatus health={health} />
    </header>
  )
}
