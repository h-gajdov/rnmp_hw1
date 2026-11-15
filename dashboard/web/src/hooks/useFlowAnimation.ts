// Drives the flow particles: ~30 times a second it advances every particle
// along its link at the link's measured speed and hands the points to the
// map. Paused while the layer is hidden; frozen for reduced motion.
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import { flowFrame, metersPerPixel, type FlowPath } from '../lib/flow'

const FRAME_MS = 33

export function useFlowAnimation(
  map: MapLibreMap | null,
  paths: FlowPath[],
  speeds: Record<string, number>,
  focus: string | null, // borough in focus; particles elsewhere are dimmed
  enabled: boolean,
) {
  const speedsRef = useRef(speeds)
  const focusRef = useRef(focus)
  useEffect(() => { speedsRef.current = speeds }, [speeds])
  useEffect(() => { focusRef.current = focus }, [focus])

  useEffect(() => {
    if (!map || !enabled) return
    const source = map.getSource<GeoJSONSource>('flow')
    if (!source) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    let last = performance.now()

    const draw = (dtSeconds: number) => {
      const focusOn = focusRef.current
      source.setData(flowFrame(paths, {
        speeds: speedsRef.current,
        dim: (p) => focusOn !== null && p.borough !== focusOn,
        dtSeconds,
        metersPerPx: metersPerPixel(map.getZoom(), map.getCenter().lat),
      }))
    }

    const tick = (t: number) => {
      frame = requestAnimationFrame(tick)
      if (t - last < FRAME_MS) return
      draw(Math.min(0.1, (t - last) / 1000)) // a background tab must not make particles jump
      last = t
    }

    if (still) {
      draw(0)
      const timer = window.setInterval(() => draw(0), 1000) // follow new data, no motion
      return () => window.clearInterval(timer)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [map, paths, enabled])
}
