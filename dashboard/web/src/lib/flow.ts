// Traffic flow particles: small dots that travel along every road link at a
// screen speed proportional to the link's measured average speed, so a
// jammed road visibly crawls and a free road streams.
//
// Direction: the DOT polylines are not always drawn in the direction of
// travel (e.g. "LINCOLN TUNNEL E ... NJ - NY" is drawn from NY to NJ), so
// each link is oriented by the signed direction in its name (N/S/E/W, NB...)
// when there is one; otherwise the geometry order is kept.
import type { Feature, FeatureCollection, Point } from 'geojson'
import type { LinkFeature } from '../types'

const SPACING_M = 520 // distance between two particles on a link
const PX_PER_S_PER_MPH = 0.32 // 30 mph moves ~10 px/s on screen at any zoom
const EARTH = 40_075_016.686

const UNIT: Record<string, [number, number]> = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] }

export interface FlowPath {
  id: string
  borough: string
  coords: [number, number][]
  cum: number[] // cumulative distance (m) at each vertex
  length: number
  step: number // spacing between particles on this link (m)
  count: number
  phase: number // how far the first particle has travelled (m), mod step
}

const metersBetween = (a: [number, number], b: [number, number]) => {
  const kx = 111_320 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180))
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 110_574)
}

/** The signed direction from a DOT link name, e.g. "BQE N Atlantic Ave - ..." -> N. */
export function signedDirection(name: string): string | null {
  const m = /\b([NSEW])B?\b/.exec(name)
  return m ? m[1] : null
}

function oriented(f: LinkFeature): [number, number][] {
  const c = f.geometry.coordinates
  const dir = signedDirection(f.properties.link_name)
  if (!dir || c.length < 2) return c
  const [ux, uy] = UNIT[dir]
  const dx = (c[c.length - 1][0] - c[0][0]) * Math.cos((c[0][1] * Math.PI) / 180)
  const dy = c[c.length - 1][1] - c[0][1]
  return dx * ux + dy * uy < 0 ? [...c].reverse() : c
}

export function buildFlowPaths(features: LinkFeature[]): FlowPath[] {
  return features.map((f) => {
    const coords = oriented(f)
    const cum = [0]
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + metersBetween(coords[i - 1], coords[i]))
    const length = cum[cum.length - 1] || 1
    const count = Math.max(1, Math.round(length / SPACING_M))
    return {
      id: f.properties.link_id,
      borough: f.properties.borough,
      coords,
      cum,
      length,
      step: length / count,
      count,
      phase: Math.random() * (length / count), // so links do not pulse in sync
    }
  })
}

function pointAt(p: FlowPath, d: number): [number, number] {
  let i = 1
  while (i < p.cum.length - 1 && p.cum[i] < d) i++
  const seg = p.cum[i] - p.cum[i - 1] || 1
  const t = (d - p.cum[i - 1]) / seg
  const a = p.coords[i - 1]
  const b = p.coords[i]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** Meters per screen pixel at the given zoom and latitude (512 px tiles). */
export const metersPerPixel = (zoom: number, lat: number) =>
  (EARTH * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)

export interface FlowFrameOptions {
  speeds: Record<string, number> // link_id -> mph; links without a value get no particles
  dim: (path: FlowPath) => boolean
  dtSeconds: number
  metersPerPx: number
}

/** Advances every particle by dt and returns them as GeoJSON points. */
export function flowFrame(paths: FlowPath[], o: FlowFrameOptions): FeatureCollection<Point> {
  const features: Feature<Point>[] = []
  for (const p of paths) {
    const mph = o.speeds[p.id]
    if (mph === undefined) continue
    p.phase = (p.phase + mph * PX_PER_S_PER_MPH * o.metersPerPx * o.dtSeconds) % p.step
    const dim = o.dim(p)
    for (let k = 0; k < p.count; k++) {
      features.push({
        type: 'Feature',
        properties: { dim, mph },
        geometry: { type: 'Point', coordinates: pointAt(p, p.phase + k * p.step) },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}
