import type { IncidentType, Level, Severity } from '../types'

// Congestion levels from the contract: ratio = avg speed / free-flow speed.
// These four are the only saturated colors in the interface. Checked with the
// dataviz palette validator against the light map land (#FBFBF9): adjacent
// pairs separate under protan/deutan simulation and with full color vision.
// Moderate is below 3:1 against the land, so it never carries meaning alone:
// links also thicken as they slow down, and every view has counts or labels.
export const LEVELS: { level: Level; label: string; min: number; color: string }[] = [
  { level: 'FREE', label: 'Free flow', min: 0.75, color: '#2E9B5A' },
  { level: 'MODERATE', label: 'Moderate', min: 0.5, color: '#D99A00' },
  { level: 'HEAVY', label: 'Heavy', min: 0.3, color: '#E4572E' },
  { level: 'SEVERE', label: 'Severe', min: 0, color: '#9E1B1B' },
]

export const SILENT_COLOR = '#8D949A'
export const NO_DATA_COLOR = '#C5CACD'

export const levelInfo = (level: Level) => LEVELS.find((l) => l.level === level)!

export const levelOf = (ratio: number): Level => LEVELS.find((l) => ratio >= l.min)!.level

export const INCIDENT_LABELS: Record<IncidentType, string> = {
  SPEED_DROP: 'Speed drop',
  PERSISTENT_CONGESTION: 'Persistent congestion',
  RECOVERY: 'Recovery',
  SENSOR_SILENT: 'Sensor silent',
}

export const INCIDENT_COLORS: Record<IncidentType, string> = {
  SPEED_DROP: '#E4572E',
  PERSISTENT_CONGESTION: '#9E1B1B',
  RECOVERY: '#2E9B5A',
  SENSOR_SILENT: SILENT_COLOR,
}

// Severity reuses the congestion scale (worse is darker red), always with its word.
export const SEVERITY_COLORS: Record<Severity, string> = {
  CRITICAL: '#9E1B1B',
  HIGH: '#E4572E',
  MEDIUM: '#D99A00',
  LOW: SILENT_COLOR,
}

export const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
