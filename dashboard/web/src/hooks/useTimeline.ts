// The event-time range the bridge can travel back over, plus the network speed
// series drawn on the time bar. Refreshed every few seconds while the stream runs.
import { useEffect, useState } from 'react'
import type { TimelineSummary } from '../types'

const REFRESH_MS = 15_000

export function useTimeline() {
  const [summary, setSummary] = useState<TimelineSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/timeline')
        if (res.ok && !cancelled) setSummary(await res.json())
      } catch {
        // bridge not up yet; the next refresh tries again
      }
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return summary
}
