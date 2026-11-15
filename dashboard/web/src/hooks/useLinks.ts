// Loads the static road geometry (data/links.geojson via the bridge).
// The producer may still be downloading it, so retry until it has features.
import { useEffect, useState } from 'react'
import type { LinksGeoJson } from '../types'

const RETRY_MS = 5000

export function useLinks() {
  const [links, setLinks] = useState<LinksGeoJson | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const load = async () => {
      try {
        const res = await fetch('/api/links')
        const data: LinksGeoJson = await res.json()
        if (!cancelled && data.features?.length) return setLinks(data)
      } catch {
        // bridge not up yet, try again below
      }
      if (!cancelled) timer = window.setTimeout(load, RETRY_MS)
    }
    load()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  return links
}
