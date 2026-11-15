// MapLibre sources and layers: borough areas, road links, flow particles and
// incident markers. Link colors are data-driven through *feature state*: the
// map component calls setFeatureState(link, { ratio, silent, dim }) whenever
// a new window arrives or the borough focus changes.
import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { INCIDENT_COLORS, LEVELS, NO_DATA_COLOR, SILENT_COLOR } from './levels'

export const BASEMAP = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

// The basemap is retinted like a printed street map: the region outside the
// city recedes to grey, water is a muted blue-grey and the five boroughs are
// drawn on top as flat near-white land, so the monitored city reads first.
const REGION = '#E6E7E3'
const WATER = '#CBD6DC'
const LAND = '#FBFBF9'
const INK = '#16191C'
const CASING = '#FFFFFF'

export function restyleBasemap(m: MapLibreMap) {
  for (const layer of m.getStyle().layers) {
    if (layer.type === 'symbol') {
      m.setPaintProperty(layer.id, 'text-opacity', 0.75)
      m.setPaintProperty(layer.id, 'text-halo-color', REGION)
    }
  }
  m.setPaintProperty('background', 'background-color', REGION)
  for (const id of ['landcover', 'landuse', 'landuse_residential', 'park_national_park', 'park_nature_reserve']) {
    if (m.getLayer(id)) m.setPaintProperty(id, 'fill-opacity', 0)
  }
  if (m.getLayer('water')) m.setPaintProperty('water', 'fill-color', WATER)
  for (const id of ['boundary_county', 'boundary_state']) {
    if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none')
  }
}

/** First basemap road layer: borough areas go below it, so roads stay crisp. */
export const BELOW_ROADS = 'tunnel_service_case'

const color = (level: string) => LEVELS.find((l) => l.level === level)!.color
const ratio: ExpressionSpecification = ['to-number', ['feature-state', 'ratio'], 1]
const dimmed: ExpressionSpecification = ['boolean', ['feature-state', 'dim'], false]
const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false]
const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false]

// Flat land divided by water. Brooklyn and Queens share a land border, so a
// faint hairline separates them; hover and focus draw it in ink.
export const boroughLayers: LayerSpecification[] = [
  {
    id: 'borough-fill',
    type: 'fill',
    source: 'boroughs',
    paint: {
      'fill-color': ['case', selected, '#FFFFFF', hovered, '#FFFFFF', dimmed, '#EFF0EC', LAND],
      'fill-color-transition': { duration: 200 },
    },
  },
  {
    id: 'borough-outline',
    type: 'line',
    source: 'boroughs',
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': ['case', selected, INK, hovered, INK, '#B9BFBC'],
      'line-width': ['case', selected, 1.6, hovered, 1.2, 0.6],
      'line-opacity': ['case', selected, 0.9, hovered, 0.7, 1],
    },
  },
]

// Smooth gradient whose anchors sit inside each level band,
// so e.g. 0.6 (MODERATE) reads yellow and 0.2 (SEVERE) reads red.
const congestionColor: ExpressionSpecification = [
  'case',
  ['boolean', ['feature-state', 'silent'], false], SILENT_COLOR,
  ['==', ['feature-state', 'ratio'], null], NO_DATA_COLOR,
  ['interpolate', ['linear'], ratio,
    0.22, color('SEVERE'),
    0.4, color('HEAVY'),
    0.62, color('MODERATE'),
    0.85, color('FREE')],
]

// Worse congestion draws a slightly thicker line (a second cue besides color).
const width = (base: number): ExpressionSpecification => [
  'interpolate', ['linear'], ['zoom'],
  9, ['*', base, ['interpolate', ['linear'], ratio, 0.2, 1.8, 0.8, 1]],
  14, ['*', base * 3, ['interpolate', ['linear'], ratio, 0.2, 1.8, 0.8, 1]],
]

export const linkLayers: LayerSpecification[] = [
  {
    id: 'links-casing',
    type: 'line',
    source: 'links',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': CASING,
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 5, 14, 13],
      'line-opacity': ['case', dimmed, 0.3, 1],
    },
  },
  {
    id: 'links-selected',
    type: 'line',
    source: 'links',
    filter: ['==', ['get', 'link_id'], ''],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': INK, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 8, 14, 18] },
  },
  {
    id: 'links-line',
    type: 'line',
    source: 'links',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': congestionColor,
      'line-width': width(2),
      'line-opacity': ['case', dimmed, 0.25, 1],
    },
  },
  {
    // invisible wide line that makes thin links easy to hover and click
    id: 'links-hit',
    type: 'line',
    source: 'links',
    paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 },
  },
]

export const flowLayers: LayerSpecification[] = [
  {
    id: 'flow-particles',
    type: 'circle',
    source: 'flow',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.1, 12, 1.8, 15, 3],
      'circle-color': INK,
      'circle-opacity': ['case', ['get', 'dim'], 0.12, 0.7],
      'circle-pitch-alignment': 'map',
    },
  },
]

const incidentColor: ExpressionSpecification = ['match', ['get', 'type'],
  'PERSISTENT_CONGESTION', INCIDENT_COLORS.PERSISTENT_CONGESTION,
  'SENSOR_SILENT', INCIDENT_COLORS.SENSOR_SILENT,
  INCIDENT_COLORS.SPEED_DROP]

// A solid pin in the incident's color on a white rim; critical ones get a thin outer ring.
export const incidentLayers: LayerSpecification[] = [
  {
    id: 'incident-ring',
    type: 'circle',
    source: 'incidents',
    filter: ['==', ['get', 'severity'], 'CRITICAL'],
    paint: {
      'circle-radius': 10,
      'circle-color': 'transparent',
      'circle-stroke-width': 1,
      'circle-stroke-color': INK,
      'circle-stroke-opacity': ['case', ['get', 'dim'], 0.1, 0.55],
    },
  },
  {
    id: 'incident-dot',
    type: 'circle',
    source: 'incidents',
    paint: {
      'circle-radius': ['match', ['get', 'severity'], 'CRITICAL', 6, 'HIGH', 5.5, 4.5],
      'circle-color': incidentColor,
      'circle-opacity': ['case', ['get', 'dim'], 0.3, 1],
      'circle-stroke-width': 2,
      'circle-stroke-color': CASING,
      'circle-stroke-opacity': ['case', ['get', 'dim'], 0.3, 1],
    },
  },
]

/** Layer groups the viewer can switch on and off. */
export const LAYER_GROUPS = {
  flow: flowLayers.map((l) => l.id),
  boroughs: boroughLayers.map((l) => l.id),
  incidents: incidentLayers.map((l) => l.id),
} as const

export type LayerGroup = keyof typeof LAYER_GROUPS
