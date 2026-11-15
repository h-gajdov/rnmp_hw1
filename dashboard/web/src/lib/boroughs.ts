// The five boroughs: one identity color each, used for the map areas, the
// map labels and the borough strip. The hues stay clear of the four
// congestion colors (green/yellow/orange/red) so a borough tint is never
// read as a traffic level. Identity is never color alone: every borough
// area and card is labelled with its name. Neighbours on the map (Manhattan
// against Bronx, Queens and Brooklyn; Brooklyn against Queens) get the most
// separated pairs; checked with the dataviz palette validator (dark mode).
import { useEffect, useState } from 'react'

export const BOROUGHS = [
  { name: 'Manhattan', color: '#D06A98' },
  { name: 'Brooklyn', color: '#21A3B8' },
  { name: 'Queens', color: '#4D69D6' },
  { name: 'Bronx', color: '#BC8A45' },
  { name: 'Staten Island', color: '#A07AE0' },
] as const

/** Where a borough's map label goes when the polygon's own label point is
 *  a bad spot: Manhattan is too narrow, a label inside it would cover the
 *  FDR Drive and West Side Highway links, so it sits on the Hudson instead. */
export const LABEL_OVERRIDES: Record<string, { at: [number, number]; anchor: 'right' | 'center' }> = {
  Manhattan: { at: [-74.008, 40.785], anchor: 'right' },
}

export type BoroughName = (typeof BOROUGHS)[number]['name']

export const boroughColor = (name: string) => BOROUGHS.find((b) => b.name === name)?.color ?? '#8a97a6'

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
