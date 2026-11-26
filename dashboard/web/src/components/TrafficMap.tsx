import {
  LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl,
  type GeoJSONSource, type LngLatBoundsLike, type PaddingOptions,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFlowAnimation } from '../hooks/useFlowAnimation'
import type { ReadingSubscribe } from '../hooks/useLiveFeed'
import { useReadingPulses } from '../hooks/useReadingPulses'
import { useRatioTween } from '../hooks/useRatioTween'
import { boroughColor, LABEL_OVERRIDES, type BoroughGeoJson } from '../lib/boroughs'
import { buildFlowPaths } from '../lib/flow'
import {
  BASEMAP, BELOW_ROADS, boroughLayers, flowLayers, incidentLayers, LAYER_GROUPS, linkLayers, pulseLayers,
  restyleBasemap,
  type LayerGroup,
} from '../lib/mapLayers'
import type { BoroughStats, Incident, LinkStats, LinksGeoJson } from '../types'
import { LinkTooltip } from './LinkTooltip'

interface Props {
  geojson: LinksGeoJson
  boroughShapes: BoroughGeoJson | null
  boroughNow: Record<string, BoroughStats | undefined>
  links: Record<string, LinkStats>
  active: Record<string, Incident>
  silent: Record<string, Incident>
  selectedId: string | null
  onSelect: (linkId: string | null) => void
  focusBorough: string | null
  onFocusBorough: (borough: string | null) => void
  hoverBorough: string | null
  onHoverBorough: (borough: string | null) => void
  layers: Record<LayerGroup, boolean>
  onReading: ReadingSubscribe
  live: boolean // false while a past moment is shown: no pulses then
}

// Let Vite serve/bundle MapLibre's web worker as a plain file.
setWorkerUrl(workerUrl)

interface Hover { linkId: string; x: number; y: number; flip: boolean }

const EMPTY = { type: 'FeatureCollection' as const, features: [] }

function boundsOfLines(geojson: LinksGeoJson) {
  const b = new LngLatBounds()
  for (const f of geojson.features) for (const c of f.geometry.coordinates) b.extend(c)
  return b
}

function boundsOfBorough(shapes: BoroughGeoJson, name: string) {
  const b = new LngLatBounds()
  for (const f of shapes.features) {
    if (f.properties.borough !== name) continue
    for (const poly of f.geometry.coordinates) for (const c of poly[0]) b.extend(c)
  }
  return b
}

// Keep the camera clear of the legend (bottom left) on wide screens.
const framePadding = (el: HTMLElement): PaddingOptions =>
  el.clientWidth > 900
    ? { top: 48, bottom: 48, left: 300, right: 64 }
    : { top: 24, bottom: 24, left: 24, right: 24 }

export function TrafficMap(props: Props) {
  const {
    geojson, boroughShapes, boroughNow, links, active, silent, selectedId,
    focusBorough, hoverBorough, layers, onReading, live,
  } = props
  const container = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [labels, setLabels] = useState<{ name: string; el: HTMLElement }[]>([])

  // The map's event handlers always call the latest callbacks.
  const handlers = useRef(props)
  useEffect(() => { handlers.current = props })

  // Create the map once, add our sources/layers when the basemap is loaded.
  useEffect(() => {
    const el = container.current!
    const m = new MapLibreMap({
      container: el,
      style: BASEMAP,
      bounds: boundsOfLines(geojson) as LngLatBoundsLike,
      fitBoundsOptions: { padding: framePadding(el) },
      attributionControl: { compact: true },
    })
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    m.on('load', () => {
      restyleBasemap(m)
      m.addSource('links', { type: 'geojson', data: geojson, promoteId: 'link_id' })
      m.addSource('flow', { type: 'geojson', data: EMPTY })
      m.addSource('pulses', { type: 'geojson', data: EMPTY })
      m.addSource('incidents', { type: 'geojson', data: EMPTY })
      for (const layer of [...linkLayers, ...flowLayers, ...pulseLayers, ...incidentLayers]) m.addLayer(layer)

      let lastBorough: string | null = null
      const setBoroughHover = (name: string | null) => {
        if (name === lastBorough) return
        lastBorough = name
        handlers.current.onHoverBorough(name)
      }

      m.on('mousemove', (e) => {
        const link = m.queryRenderedFeatures(e.point, { layers: ['links-hit'] })[0]
        const linkId = link?.properties?.link_id as string | undefined
        const borough = !linkId && m.getLayer('borough-fill')
          ? (m.queryRenderedFeatures(e.point, { layers: ['borough-fill'] })[0]?.properties?.borough as string | undefined)
          : undefined
        m.getCanvas().style.cursor = linkId || borough ? 'pointer' : ''
        // open the card to the left near the right edge, so it stays on the map
        const flip = e.point.x > m.getContainer().clientWidth - 330
        setHover(linkId ? { linkId, x: e.point.x, y: e.point.y, flip } : null)
        setBoroughHover(borough ?? null)
      })
      m.getCanvas().addEventListener('mouseleave', () => {
        setHover(null)
        setBoroughHover(null)
      })
      m.on('click', (e) => {
        const { onSelect, onFocusBorough, focusBorough: current } = handlers.current
        const link = m.queryRenderedFeatures(e.point, { layers: ['links-hit'] })[0]
        if (link) return onSelect(link.properties.link_id as string)
        onSelect(null)
        const area = m.getLayer('borough-fill') && m.queryRenderedFeatures(e.point, { layers: ['borough-fill'] })[0]
        const name = area ? (area.properties.borough as string) : null
        onFocusBorough(name === current ? null : name)
      })
      setMap(m)
    })
    return () => {
      setMap(null)
      m.remove()
    }
  }, [geojson])

  // Borough areas (the file may arrive after the map is ready) and their labels.
  useEffect(() => {
    if (!map || !boroughShapes) return
    map.addSource('boroughs', { type: 'geojson', data: boroughShapes, promoteId: 'borough' })
    for (const layer of boroughLayers) map.addLayer(layer, map.getLayer(BELOW_ROADS) ? BELOW_ROADS : 'links-casing')

    const markers = boroughShapes.features.map((f) => {
      const el = document.createElement('div')
      const override = LABEL_OVERRIDES[f.properties.borough]
      const marker = new Marker({ element: el, anchor: override?.anchor ?? 'center' })
        .setLngLat(override?.at ?? [f.properties.label_lon, f.properties.label_lat])
        .addTo(map)
      return { name: f.properties.borough, el, marker }
    })
    // the marker elements live outside React; hand them over for the portals below
    // oxlint-disable-next-line react/set-state-in-effect
    setLabels(markers.map(({ name, el }) => ({ name, el })))
    return () => {
      setLabels([])
      for (const { marker } of markers) marker.remove()
      if (!map.getStyle()) return // map already removed
      for (const layer of boroughLayers) if (map.getLayer(layer.id)) map.removeLayer(layer.id)
      if (map.getSource('boroughs')) map.removeSource('boroughs')
    }
  }, [map, boroughShapes])

  // Layer switches.
  useEffect(() => {
    if (!map) return
    for (const [group, ids] of Object.entries(LAYER_GROUPS)) {
      for (const id of ids) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', layers[group as LayerGroup] ? 'visible' : 'none')
      }
    }
  }, [map, layers, labels])

  // Link colors: animate each link's ratio towards its newest window.
  const ratios = useMemo(
    () => Object.fromEntries(Object.values(links).map((l) => [l.link_id, l.congestion_ratio])),
    [links],
  )
  useRatioTween(map, ratios)

  // Silent sensors are drawn grey; links outside the focused borough recede.
  useEffect(() => {
    if (!map) return
    for (const f of geojson.features) {
      const id = f.properties.link_id
      map.setFeatureState({ source: 'links', id }, {
        silent: id in silent,
        dim: focusBorough !== null && f.properties.borough !== focusBorough,
      })
    }
  }, [map, geojson, silent, focusBorough])

  // Borough focus and hover states.
  useEffect(() => {
    if (!map || !boroughShapes || !map.getSource('boroughs')) return
    for (const f of boroughShapes.features) {
      const name = f.properties.borough
      map.setFeatureState({ source: 'boroughs', id: name }, {
        selected: name === focusBorough,
        dim: focusBorough !== null && name !== focusBorough,
        hover: name === hoverBorough,
      })
    }
  }, [map, boroughShapes, focusBorough, hoverBorough, labels])

  // Move the camera to the focused borough, or back to the whole network.
  const firstFocus = useRef(true)
  useEffect(() => {
    if (!map) return
    if (firstFocus.current) {
      firstFocus.current = false
      if (focusBorough === null) return
    }
    const target = focusBorough && boroughShapes ? boundsOfBorough(boroughShapes, focusBorough) : boundsOfLines(geojson)
    map.fitBounds(target, { padding: framePadding(map.getContainer()), duration: 900, essential: true })
  }, [map, focusBorough, boroughShapes, geojson])

  // Flow particles move at each link's measured speed (silent sensors stand still).
  const paths = useMemo(() => buildFlowPaths(geojson.features), [geojson])
  const speeds = useMemo(
    () => Object.fromEntries(
      Object.values(links).filter((l) => !(l.link_id in silent)).map((l) => [l.link_id, l.avg_speed_mph]),
    ),
    [links, silent],
  )
  useFlowAnimation(map, paths, speeds, focusBorough, layers.flow)
  useEffect(() => {
    if (map && !layers.flow) map.getSource<GeoJSONSource>('flow')?.setData(EMPTY)
  }, [map, layers.flow])

  // A ring on a road whenever one of its readings arrives (live view only).
  useReadingPulses(map, geojson, onReading, focusBorough, live && layers.pulses)

  // One marker in the middle of every link with an open incident or a silent sensor.
  useEffect(() => {
    if (!map) return
    const byId = new Map(geojson.features.map((f) => {
      const c = f.geometry.coordinates
      return [f.properties.link_id, { mid: c[Math.floor(c.length / 2)], borough: f.properties.borough }]
    }))
    const features = [...Object.values(silent), ...Object.values(active)]
      .filter((i) => byId.has(i.link_id))
      .map((i) => {
        const link = byId.get(i.link_id)!
        return {
          type: 'Feature' as const,
          properties: {
            link_id: i.link_id, type: i.type, severity: i.severity,
            dim: focusBorough !== null && link.borough !== focusBorough,
          },
          geometry: { type: 'Point' as const, coordinates: link.mid },
        }
      })
    map.getSource<GeoJSONSource>('incidents')?.setData({ type: 'FeatureCollection', features })
  }, [map, geojson, active, silent, focusBorough])

  // Outline the selected link.
  useEffect(() => {
    map?.setFilter('links-selected', ['==', ['get', 'link_id'], selectedId ?? ''])
  }, [map, selectedId])

  const hovered = hover && geojson.features.find((f) => f.properties.link_id === hover.linkId)

  return (
    <div className="map">
      <div ref={container} className="map__canvas" />
      {layers.boroughs && labels.map(({ name, el }) => createPortal(
        <button
          type="button"
          className={[
            'borough-label',
            name === focusBorough && 'is-focus',
            focusBorough !== null && name !== focusBorough && 'is-dim',
            name === hoverBorough && 'is-hover',
          ].filter(Boolean).join(' ')}
          style={{ '--borough': boroughColor(name) } as React.CSSProperties}
          onClick={() => props.onFocusBorough(name === focusBorough ? null : name)}
          onMouseEnter={() => props.onHoverBorough(name)}
          onMouseLeave={() => props.onHoverBorough(null)}
          aria-pressed={name === focusBorough}
          aria-label={`Focus ${name}`}
        >
          <span className="borough-label__name">{name}</span>
          {boroughNow[name] && (
            <span className="borough-label__speed">{boroughNow[name]!.avg_speed_mph.toFixed(0)} mph</span>
          )}
        </button>,
        el,
        name,
      ))}
      {hover && hovered && (
        <LinkTooltip
          x={hover.x}
          y={hover.y}
          feature={hovered}
          stats={links[hover.linkId]}
          incident={active[hover.linkId] ?? silent[hover.linkId]}
          flip={hover.flip}
        />
      )}
    </div>
  )
}
