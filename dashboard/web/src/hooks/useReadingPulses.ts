// A short ring on a road each time one of its sensor readings arrives, so the
// stream is visible between the 5-minute window updates. Purely visual: the
// road's color still comes from Flink's window statistics.
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useMemo, useRef } from 'react'
import type { ReadingSubscribe } from './useLiveFeed'
import type { LinksGeoJson } from '../types'

const DURATION_MS = 1600
const EMPTY = { type: 'FeatureCollection' as const, features: [] }

export function useReadingPulses(
  map: MapLibreMap | null,
  geojson: LinksGeoJson,
  subscribe: ReadingSubscribe,
  focus: string | null, // borough in focus; pulses elsewhere are dimmed
  enabled: boolean,
) {
  const focusRef = useRef(focus)
  useEffect(() => { focusRef.current = focus }, [focus])

  // Same anchor as the incident markers: the middle vertex of the link.
  const anchors = useMemo(() => new Map(geojson.features.map((f) => {
    const c = f.geometry.coordinates
    return [f.properties.link_id, { at: c[Math.floor(c.length / 2)], borough: f.properties.borough }]
  })), [geojson])

  useEffect(() => {
    if (!map || !enabled) return
    const source = map.getSource<GeoJSONSource>('pulses')
    if (!source) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const started = new Map<string, number>() // link_id -> when its newest reading arrived
    let frame: number | null = null

    const draw = (t: number) => {
      const focusOn = focusRef.current
      const features = []
      for (const [id, start] of started) {
        const p = Math.max(0, (t - start) / DURATION_MS)
        if (p >= 1) {
          started.delete(id)
          continue
        }
        const link = anchors.get(id)!
        features.push({
          type: 'Feature' as const,
          // grow drives the radius; with reduced motion the ring only fades
          properties: { p, grow: still ? 0.5 : p, dim: focusOn !== null && link.borough !== focusOn },
          geometry: { type: 'Point' as const, coordinates: link.at },
        })
      }
      source.setData({ type: 'FeatureCollection', features })
      frame = started.size ? requestAnimationFrame(draw) : null
    }

    const unsubscribe = subscribe((reading) => {
      if (!anchors.has(reading.link_id)) return
      started.set(reading.link_id, performance.now()) // a new reading restarts the ring
      frame ??= requestAnimationFrame(draw)
    })

    return () => {
      unsubscribe()
      if (frame !== null) cancelAnimationFrame(frame)
      if (map.getStyle() && map.getSource('pulses')) source.setData(EMPTY)
    }
  }, [map, anchors, subscribe, enabled])
}
