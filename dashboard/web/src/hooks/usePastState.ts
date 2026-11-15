// The dashboard state at a past event time, rebuilt by the bridge (GET /api/state).
//
// Scrubbing asks for many times in a row; only one request is in flight and when
// it returns the newest wanted time is fetched next, so the bridge is never
// flooded and the view always settles on where the slider stopped.
import { useEffect, useRef, useState } from 'react'
import { fromSnapshot, type DashboardState } from '../state/dashboard'
import type { Snapshot } from '../types'

export interface PastState {
  at: number
  state: DashboardState
}

export function usePastState(at: number | null) {
  const [past, setPast] = useState<PastState | null>(null)
  const wanted = useRef<number | null>(null)
  const loaded = useRef<number | null>(null)
  const busy = useRef(false)

  useEffect(() => {
    wanted.current = at
    if (at === null) {
      loaded.current = null
      return
    }
    if (busy.current) return // the running loop picks the new time up

    busy.current = true
    void (async () => {
      try {
        while (wanted.current !== null && wanted.current !== loaded.current) {
          const target = wanted.current
          const res = await fetch(`/api/state?at=${target}`)
          if (!res.ok) break
          const snapshot: Snapshot = await res.json()
          loaded.current = target
          if (wanted.current !== null) setPast({ at: target, state: fromSnapshot(snapshot) })
        }
      } catch {
        // bridge unreachable: keep showing the last past state
      } finally {
        busy.current = false
      }
    })()
  }, [at])

  return at === null ? null : past
}
