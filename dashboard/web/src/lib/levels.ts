import type { Incident, IncidentType, Level, Severity } from '../types'

// Congestion levels from the contract: ratio = avg speed / free-flow speed.
// These four are the only saturated colors in the interface. Checked with the
// dataviz palette validator against the dark map land (#1E2227) and panels:
// every color clears 3:1, adjacent levels separate under protan/deutan
// simulation (>= 10) and with full color vision (>= 16). Free flow against
// heavy is only 7.4 under deutan, so links also thicken as they slow down.
export const LEVELS: { level: Level; label: string; min: number; color: string }[] = [
  { level: 'FREE', label: 'Free flow', min: 0.75, color: '#2DB665' },
  { level: 'MODERATE', label: 'Moderate', min: 0.5, color: '#E8C547' },
  { level: 'HEAVY', label: 'Heavy', min: 0.3, color: '#F0782C' },
  { level: 'SEVERE', label: 'Severe', min: 0, color: '#D7263D' },
]

export const SILENT_COLOR = '#7C858E'
export const NO_DATA_COLOR = '#3B4148'

export const levelInfo = (level: Level) => LEVELS.find((l) => l.level === level)!

export const levelOf = (ratio: number): Level => LEVELS.find((l) => ratio >= l.min)!.level

export const INCIDENT_LABELS: Record<IncidentType, string> = {
  SPEED_DROP: 'Speed drop',
  PERSISTENT_CONGESTION: 'Persistent congestion',
  RECOVERY: 'Recovery',
  SENSOR_SILENT: 'Sensor silent',
}

export const INCIDENT_COLORS: Record<IncidentType, string> = {
  SPEED_DROP: '#F0782C',
  PERSISTENT_CONGESTION: '#D7263D',
  RECOVERY: '#2DB665',
  SENSOR_SILENT: SILENT_COLOR,
}

// Severity reuses the congestion scale, always with its word.
export const SEVERITY_COLORS: Record<Severity, string> = {
  CRITICAL: '#D7263D',
  HIGH: '#F0782C',
  MEDIUM: '#E8C547',
  LOW: SILENT_COLOR,
}

export const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

/** Worst severity first, then the incident that has been open longest. */
export const byWorst = (a: Incident, b: Incident) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.incident_start - b.incident_start
