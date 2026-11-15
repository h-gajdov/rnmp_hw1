// Moves every link's displayed congestion ratio smoothly to its newest value,
// so colors fade (about one second) instead of jumping when a window arrives.
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useRef } from 'react'

const DURATION_MS = 1200

interface Tween { from: number; to: number; start: number }

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useRatioTween(map: MapLibreMap | null, targets: Record<string, number>) {
  const shown = useRef(new Map<string, number>()) // ratio currently drawn per link
  const tweens = useRef(new Map<string, Tween>())
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (!map) return
    const now = performance.now()
    const instant = reducedMotion()

    for (const [id, to] of Object.entries(targets)) {
      const from = shown.current.get(id)
      if (from === to || tweens.current.get(id)?.to === to) continue
      if (from === undefined || instant) {
        shown.current.set(id, to)
        map.setFeatureState({ source: 'links', id }, { ratio: to })
      } else {
        tweens.current.set(id, { from, to, start: now })
      }
    }

    const step = (t: number) => {
      for (const [id, tw] of tweens.current) {
        const p = Math.min(1, (t - tw.start) / DURATION_MS)
        const eased = 1 - (1 - p) ** 3
        const value = tw.from + (tw.to - tw.from) * eased
        shown.current.set(id, value)
        map.setFeatureState({ source: 'links', id }, { ratio: value })
        if (p === 1) tweens.current.delete(id)
      }
      frame.current = tweens.current.size ? requestAnimationFrame(step) : null
    }
    if (tweens.current.size && frame.current === null) frame.current = requestAnimationFrame(step)
  }, [map, targets])

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
  }, [])
}
