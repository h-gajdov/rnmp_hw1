// Network-wide flow figures, derived in the browser from data the contract
// already delivers (no extra topic):
//  - network speed per 5-minute window: the borough windows
//    (traffic-borough-stats) combined, weighted by their reading counts
//  - congestion mix per window: every link's recent windows
//    (traffic-link-stats history) bucketed into the four levels
import type { BoroughStats, Level, LinkPoint } from '../types'
import { LEVELS, levelOf } from './levels'

export interface NetworkWindow {
  t: number // window end, epoch ms
  speed: number // reading-weighted average speed, mph
  readings: number
  slowShare: number
}

/** One point per 5-minute window that every reporting borough has closed. */
export function networkSeries(boroughs: Record<string, BoroughStats[]>): NetworkWindow[] {
  const series = Object.values(boroughs)
  if (!series.length) return []
  const byEnd = new Map<number, BoroughStats[]>()
  for (const s of series) for (const w of s) byEnd.set(w.window_end, [...(byEnd.get(w.window_end) ?? []), w])
  const complete = Math.max(...[...byEnd.values()].map((ws) => ws.length))
  return [...byEnd.entries()]
    .filter(([, ws]) => ws.length === complete)
    .sort(([a], [b]) => a - b)
    .map(([t, ws]) => {
      const readings = ws.reduce((a, w) => a + w.readings, 0) || 1
      return {
        t,
        readings,
        speed: ws.reduce((a, w) => a + w.avg_speed_mph * w.readings, 0) / readings,
        slowShare: ws.reduce((a, w) => a + w.slow_share * w.readings, 0) / readings,
      }
    })
}

export interface LevelMix {
  t: number // window end, epoch ms
  total: number
  counts: Record<Level, number>
}

/** How many links were at each congestion level, per link-stats window. */
export function levelMix(history: Record<string, LinkPoint[]>, limit = 24): LevelMix[] {
  const byEnd = new Map<number, Record<Level, number>>()
  for (const points of Object.values(history)) {
    for (const p of points) {
      let counts = byEnd.get(p.window_end)
      if (!counts) byEnd.set(p.window_end, (counts = { FREE: 0, MODERATE: 0, HEAVY: 0, SEVERE: 0 }))
      counts[levelOf(p.congestion_ratio)] += 1
    }
  }
  const mixes = [...byEnd.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, counts]) => ({ t, counts, total: LEVELS.reduce((a, l) => a + counts[l.level], 0) }))
  // The newest window can still be filling up (links report one by one), and
  // windows from before the page opened can be thin: keep the well-filled ones.
  const full = Math.max(0, ...mixes.map((m) => m.total))
  return mixes.filter((m) => m.total >= full * 0.6).slice(-limit)
}
