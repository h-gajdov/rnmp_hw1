import type { FeedHealth } from '../hooks/useLiveFeed'

const IDLE_AFTER_MS = 10_000

function describe({ status, lastMessageAt }: FeedHealth, now: number) {
  if (status === 'connecting') return { tone: 'wait', label: 'Connecting' }
  if (status === 'reconnecting') return { tone: 'down', label: 'Reconnecting' }
  if (!lastMessageAt || now - lastMessageAt > IDLE_AFTER_MS) return { tone: 'idle', label: 'Connected, stream idle' }
  return { tone: 'live', label: 'Live' }
}

function age(ms: number) {
  if (ms < 1000) return 'just now'
  if (ms < 60_000) return `${Math.round(ms / 1000)} s ago`
  return `${Math.round(ms / 60_000)} min ago`
}

/** Shows that data is really streaming: connection, message rate, last message age. */
export function LiveStatus({ health }: { health: FeedHealth }) {
  const now = Date.now() // re-rendered twice a second by useLiveFeed
  const { tone, label } = describe(health, now)
  return (
    <div className={`live live--${tone}`} role="status">
      <span className="live__dot" aria-hidden="true" />
      <span className="live__label">{label}</span>
      <span className="live__stat">
        <b>{health.messagesPerSecond.toFixed(1)}</b> msg/s
      </span>
      <span className="live__stat">
        last {health.lastMessageAt ? age(now - health.lastMessageAt) : 'never'}
      </span>
    </div>
  )
}
