// The five boroughs. On the map they are flat land divided by water and named
// in place; in the strip each one is its own labelled small multiple. They
// carry no color of their own: color in this dashboard always means traffic.
import { useEffect, useState } from 'react'

export const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'] as const

/** Where a borough's map label goes when the polygon's own label point is
 *  a bad spot: Manhattan is too narrow, a label inside it would cover the
 *  FDR Drive and West Side Highway links, so it sits on the Hudson instead. */
export const LABEL_OVERRIDES: Record<string, { at: [number, number]; anchor: 'right' | 'center' }> = {
  Manhattan: { at: [-74.008, 40.785], anchor: 'right' },
}

export type BoroughName = (typeof BOROUGHS)[number]

export interface BoroughFeature {
  type: 'Feature'
  properties: { borough: string; label_lon: number; label_lat: number }
  geometry: { type: 'MultiPolygon'; coordinates: [number, number][][][] }
}

export interface BoroughGeoJson {
  type: 'FeatureCollection'
  features: BoroughFeature[]
}

/** Simplified NYC borough boundaries (NYC Open Data "Borough Boundaries",
 *  water-clipped), bundled as a static file in public/. */
export function useBoroughShapes() {
  const [shapes, setShapes] = useState<BoroughGeoJson | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}boroughs.geojson`)
      .then((r) => r.json())
      .then((data: BoroughGeoJson) => { if (!cancelled) setShapes(data) })
      .catch(() => { /* the map works without the borough areas */ })
    return () => { cancelled = true }
  }, [])
  return shapes
}
