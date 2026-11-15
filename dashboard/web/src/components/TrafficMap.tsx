import {
  LngLatBounds, Map as MapLibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type LngLatBoundsLike,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRatioTween } from '../hooks/useRatioTween'
import { BASEMAP, incidentLayers, linkLayers } from '../lib/mapLayers'
import type { Incident, LinkStats, LinksGeoJson } from '../types'
import { LinkTooltip } from './LinkTooltip'

interface Props {
  geojson: LinksGeoJson
  links: Record<string, LinkStats>
  active: Record<string, Incident>
  silent: Record<string, Incident>
  selectedId: string | null
  onSelect: (linkId: string | null) => void
}

// Let Vite serve/bundle MapLibre's web worker as a plain file.
setWorkerUrl(workerUrl)

interface Hover { linkId: string; x: number; y: number }

function boundsOf(geojson: LinksGeoJson): LngLatBoundsLike {
  const b = new LngLatBounds()
  for (const f of geojson.features) for (const c of f.geometry.coordinates) b.extend(c)
  return b
}

export function TrafficMap({ geojson, links, active, silent, selectedId, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const onSelectRef = useRef(onSelect) // the map's click handler always calls the latest one
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  // Create the map once, add our sources/layers when the basemap is loaded.
  useEffect(() => {
    const m = new MapLibreMap({
      container: container.current!,
      style: BASEMAP,
      bounds: boundsOf(geojson),
      // leave room on the left for the legend panel on wide screens
      fitBoundsOptions: { padding: container.current!.clientWidth > 900 ? { top: 30, bottom: 30, left: 300, right: 50 } : 20 },
      attributionControl: { compact: true },
    })
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    m.on('load', () => {
      // Quiet the basemap labels so the traffic colors stay in front.
      for (const layer of m.getStyle().layers) {
        if (layer.type === 'symbol') m.setPaintProperty(layer.id, 'text-opacity', 0.45)
      }
      m.addSource('links', { type: 'geojson', data: geojson, promoteId: 'link_id' })
      m.addSource('incidents', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      for (const layer of [...linkLayers, ...incidentLayers]) m.addLayer(layer)

      m.on('mousemove', 'links-hit', (e) => {
        const linkId = e.features?.[0]?.properties?.link_id as string | undefined
        m.getCanvas().style.cursor = linkId ? 'pointer' : ''
        setHover(linkId ? { linkId, x: e.point.x, y: e.point.y } : null)
      })
      m.on('mouseleave', 'links-hit', () => {
        m.getCanvas().style.cursor = ''
        setHover(null)
      })
      m.on('click', (e) => {
        const hit = m.queryRenderedFeatures(e.point, { layers: ['links-hit'] })[0]
        onSelectRef.current((hit?.properties?.link_id as string) ?? null)
      })
      setMap(m)
    })
    return () => {
      setMap(null)
      m.remove()
    }
  }, [geojson])

  // Link colors: animate each link's ratio towards its newest window.
  const ratios = useMemo(
    () => Object.fromEntries(Object.values(links).map((l) => [l.link_id, l.congestion_ratio])),
    [links],
  )
  useRatioTween(map, ratios)

  // Silent sensors are drawn grey.
  useEffect(() => {
    if (!map) return
    for (const f of geojson.features) {
      const id = f.properties.link_id
      map.setFeatureState({ source: 'links', id }, { silent: id in silent })
    }
  }, [map, geojson, silent])

  // One marker in the middle of every link with an open incident or a silent sensor.
  useEffect(() => {
    if (!map) return
    const middle = new Map(geojson.features.map((f) => {
      const c = f.geometry.coordinates
      return [f.properties.link_id, c[Math.floor(c.length / 2)]]
    }))
    const features = [...Object.values(silent), ...Object.values(active)]
      .filter((i) => middle.has(i.link_id))
      .map((i) => ({
        type: 'Feature' as const,
        properties: { link_id: i.link_id, type: i.type, severity: i.severity },
        geometry: { type: 'Point' as const, coordinates: middle.get(i.link_id)! },
      }))
    map.getSource<GeoJSONSource>('incidents')?.setData({ type: 'FeatureCollection', features })
  }, [map, geojson, active, silent])

  // Outline the selected link.
  useEffect(() => {
    map?.setFilter('links-selected', ['==', ['get', 'link_id'], selectedId ?? ''])
  }, [map, selectedId])

  const hovered = hover && geojson.features.find((f) => f.properties.link_id === hover.linkId)

  return (
    <div className="map">
      <div ref={container} className="map__canvas" />
      {hover && hovered && (
        <LinkTooltip
          x={hover.x}
          y={hover.y}
          feature={hovered}
          stats={links[hover.linkId]}
          incident={active[hover.linkId] ?? silent[hover.linkId]}
        />
      )}
    </div>
  )
}
