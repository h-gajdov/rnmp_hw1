import type { IncidentType, Level } from '../types'

// Congestion levels from the contract: ratio = avg speed / free-flow speed.
export const LEVELS: { level: Level; label: string; min: number; color: string }[] = [
  { level: 'FREE', label: 'Free flow', min: 0.75, color: '#2DB665' },
  { level: 'MODERATE', label: 'Moderate', min: 0.5, color: '#E8C547' },
  { level: 'HEAVY', label: 'Heavy', min: 0.3, color: '#F0782C' },
  { level: 'SEVERE', label: 'Severe', min: 0, color: '#D7263D' },
]

export const SILENT_COLOR = '#6E7B88'
export const NO_DATA_COLOR = '#3A4652'

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
