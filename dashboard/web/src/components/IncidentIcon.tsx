import { INCIDENT_COLORS } from '../lib/levels'
import type { IncidentType } from '../types'

// Small glyphs so an incident type is never told by color alone.
const PATHS: Record<IncidentType, string> = {
  SPEED_DROP: 'M4 5 L10 11 L13 8 L18 13 M18 13 V8.5 M18 13 H13.5', // falling line
  PERSISTENT_CONGESTION: 'M11 4 A7 7 0 1 0 11.01 4 M11 7 V11 L14 13', // clock
  RECOVERY: 'M4 15 L9 10 L12 13 L18 7 M18 7 V11.5 M18 7 H13.5', // rising line
  SENSOR_SILENT: 'M5 9 A9 9 0 0 1 17 9 M8 12 A5 5 0 0 1 14 12 M4 4 L18 18', // signal crossed out
}

export function IncidentIcon({ type, size = 22 }: { type: IncidentType; size?: number }) {
  return (
    <svg
      className="incident-icon"
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
      stroke={INCIDENT_COLORS[type]}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[type]} />
    </svg>
  )
}
