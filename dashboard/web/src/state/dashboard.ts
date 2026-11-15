// Client-side copy of the stream state. It mirrors bridge/state.py: the
// snapshot replaces everything, then every live message updates it.
import type {
  BoroughStats, Incident, IncidentType, LinkPoint, LinkStats, Reading, Snapshot,
} from '../types'

const LINK_HISTORY = 24 // 24 windows x 5 min slide = last 2 hours
const BOROUGH_HISTORY = 48 // 48 x 5 min = last 4 hours
const RECENT_INCIDENTS = 60

export interface LiveIncident extends Incident {
  /** true when it arrived while the page was open (used for the highlight) */
  live?: boolean
}

export interface DashboardState {
  eventClock: number
  links: Record<string, LinkStats>
  history: Record<string, LinkPoint[]>
  boroughs: Record<string, BoroughStats[]>
  active: Record<string, Incident> // open incidents by link_id
  silent: Record<string, Incident> // silent sensors by link_id
  recent: LiveIncident[] // newest first
  counts: Record<IncidentType, number>
  readingsTotal: number
  lateTotal: number
}

export type FeedEvent =
  | { kind: 'link_stats'; msg: LinkStats }
  | { kind: 'borough_stats'; msg: BoroughStats }
  | { kind: 'incident'; msg: Incident }
  | { kind: 'reading'; msg: Reading }
  | { kind: 'late_reading'; msg: Reading }

export type Action = { type: 'snapshot'; snapshot: Snapshot } | { type: 'events'; events: FeedEvent[] }

export const initialState: DashboardState = {
  eventClock: 0,
  links: {},
  history: {},
  boroughs: {},
  active: {},
  silent: {},
  recent: [],
  counts: { SPEED_DROP: 0, PERSISTENT_CONGESTION: 0, RECOVERY: 0, SENSOR_SILENT: 0 },
  readingsTotal: 0,
  lateTotal: 0,
}

const byLink = (list: Incident[]) => Object.fromEntries(list.map((i) => [i.link_id, i]))

export function fromSnapshot(s: Snapshot): DashboardState {
  return {
    eventClock: s.event_clock,
    links: s.links,
    history: s.link_history,
    boroughs: s.boroughs,
    active: byLink(s.active_incidents),
    silent: byLink(s.silent_links),
    recent: s.recent_incidents,
    counts: { ...initialState.counts, ...s.incident_counts },
    readingsTotal: s.readings_total,
    lateTotal: s.late_total,
  }
}

function applyLinkStats(s: DashboardState, msg: LinkStats) {
  const current = s.links[msg.link_id]
  if (!current || msg.window_end >= current.window_end) s.links[msg.link_id] = msg

  const history = s.history[msg.link_id] ?? []
  if (!history.length || msg.window_end > history[history.length - 1].window_end) {
    const point = { window_end: msg.window_end, avg_speed_mph: msg.avg_speed_mph, congestion_ratio: msg.congestion_ratio }
    s.history[msg.link_id] = [...history, point].slice(-LINK_HISTORY)
  }

  const silent = s.silent[msg.link_id]
  if (silent && msg.window_end > silent.event_time) delete s.silent[msg.link_id]
  s.eventClock = Math.max(s.eventClock, msg.window_end)
}

function applyBoroughStats(s: DashboardState, msg: BoroughStats) {
  const others = (s.boroughs[msg.borough] ?? []).filter((w) => w.window_start !== msg.window_start)
  s.boroughs[msg.borough] = [...others, msg]
    .sort((a, b) => a.window_start - b.window_start)
    .slice(-BOROUGH_HISTORY)
  s.eventClock = Math.max(s.eventClock, msg.window_end)
}

function applyIncident(s: DashboardState, msg: Incident) {
  s.counts[msg.type] += 1
  s.recent = [{ ...msg, live: true }, ...s.recent].slice(0, RECENT_INCIDENTS)
  if (msg.type === 'SPEED_DROP' || msg.type === 'PERSISTENT_CONGESTION') s.active[msg.link_id] = msg
  else if (msg.type === 'RECOVERY') delete s.active[msg.link_id]
  else if (msg.type === 'SENSOR_SILENT') s.silent[msg.link_id] = msg
  s.eventClock = Math.max(s.eventClock, msg.event_time)
}

export function reducer(state: DashboardState, action: Action): DashboardState {
  if (action.type === 'snapshot') return fromSnapshot(action.snapshot)

  // Copy the containers once per batch, then update the copy in place.
  const s: DashboardState = {
    ...state,
    links: { ...state.links },
    history: { ...state.history },
    boroughs: { ...state.boroughs },
    active: { ...state.active },
    silent: { ...state.silent },
    counts: { ...state.counts },
  }
  for (const e of action.events) {
    switch (e.kind) {
      case 'link_stats': applyLinkStats(s, e.msg); break
      case 'borough_stats': applyBoroughStats(s, e.msg); break
      case 'incident': applyIncident(s, e.msg); break
      case 'reading':
        s.readingsTotal += 1
        s.eventClock = Math.max(s.eventClock, e.msg.event_time)
        break
      case 'late_reading': s.lateTotal += 1; break
    }
  }
  return s
}
