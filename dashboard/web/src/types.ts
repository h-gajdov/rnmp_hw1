// Message shapes from docs/CONTRACT.md (only the fields the UI uses).

export type Level = 'FREE' | 'MODERATE' | 'HEAVY' | 'SEVERE'

export type IncidentType = 'SPEED_DROP' | 'PERSISTENT_CONGESTION' | 'RECOVERY' | 'SENSOR_SILENT'

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface LinkStats {
  link_id: string
  link_name: string
  borough: string
  window_start: number
  window_end: number
  count: number
  avg_speed_mph: number
  min_speed_mph: number
  max_speed_mph: number
  stddev_speed_mph: number
  avg_travel_time_s: number
  free_flow_mph: number
  congestion_ratio: number
  level: Level
}

export interface BoroughStats {
  borough: string
  window_start: number
  window_end: number
  readings: number
  links: number
  avg_speed_mph: number
  slow_share: number
}

export interface Incident {
  alert_id: string
  type: IncidentType
  link_id: string
  link_name: string
  borough: string
  event_time: number
  incident_start: number
  duration_s: number
  speed_mph: number
  baseline_mph: number
  ratio: number
  min_speed_mph: number
  severity: Severity
  message: string
}

/** A compact raw reading (the bridge strips the rest). */
export interface Reading {
  link_id: string
  speed_mph: number
  event_time: number
}

/** One point of a link's recent history, used for the sparkline. */
export interface LinkPoint {
  window_end: number
  avg_speed_mph: number
  congestion_ratio: number
}

/** What the bridge sends on (re)connect, see bridge/state.py. */
export interface Snapshot {
  event_clock: number
  links: Record<string, LinkStats>
  link_history: Record<string, LinkPoint[]>
  boroughs: Record<string, BoroughStats[]>
  active_incidents: Incident[]
  silent_links: Incident[]
  recent_incidents: Incident[]
  incident_counts: Record<IncidentType, number>
  readings_total: number
  late_total: number
}

export interface LinkFeature {
  type: 'Feature'
  properties: { link_id: string; link_name: string; borough: string }
  geometry: { type: 'LineString'; coordinates: [number, number][] }
}

export interface LinksGeoJson {
  type: 'FeatureCollection'
  features: LinkFeature[]
}
