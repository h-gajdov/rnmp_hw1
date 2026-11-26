// MapLibre sources and layers: borough areas, road links, flow particles and
// incident markers. Link colors are data-driven through *feature state*: the
// map component calls setFeatureState(link, { ratio, silent, dim }) whenever
// a new window arrives or the borough focus changes.
import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { BOROUGHS } from './boroughs'
import { INCIDENT_COLORS, LEVELS, NO_DATA_COLOR, SILENT_COLOR } from './levels'

export const BASEMAP = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// Basemap retinted to the console's slate: land a step above the page,
// water darker, labels quiet so the traffic layers stay in front.
const LAND = '#121a24'
const WATER = '#0a0f15'

export function restyleBasemap(m: MapLibreMap) {
  for (const layer of m.getStyle().layers) {
    if (layer.type === 'symbol') {
      m.setPaintProperty(layer.id, 'text-opacity', 0.42)
      m.setPaintProperty(layer.id, 'text-halo-color', WATER)
    }
  }
  m.setPaintProperty('background', 'background-color', LAND)
  for (const id of ['landcover', 'landuse', 'park_national_park', 'park_nature_reserve']) {
    if (m.getLayer(id)) m.setPaintProperty(id, 'fill-color', LAND)
  }
  if (m.getLayer('water')) m.setPaintProperty('water', 'fill-color', WATER)
}

/** First basemap road layer: borough areas go below it, so roads stay crisp. */
export const BELOW_ROADS = 'tunnel_service_case'

const color = (level: string) => LEVELS.find((l) => l.level === level)!.color
const ratio: ExpressionSpecification = ['to-number', ['feature-state', 'ratio'], 1]
const dimmed: ExpressionSpecification = ['boolean', ['feature-state', 'dim'], false]

const boroughColor: ExpressionSpecification = [
  'match', ['get', 'borough'],
  ...BOROUGHS.flatMap((b) => [b.name, b.color]),
  '#8a97a6',
] as unknown as ExpressionSpecification

const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false]
const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false]

export const boroughLayers: LayerSpecification[] = [
  {
    id: 'borough-fill',
    type: 'fill',
    source: 'boroughs',
    paint: {
      'fill-color': boroughColor,
      'fill-opacity': ['case', selected, 0.2, hovered, 0.18, dimmed, 0.03, 0.11],
      'fill-opacity-transition': { duration: 250 },
    },
  },
  {
    id: 'borough-outline',
    type: 'line',
    source: 'boroughs',
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': boroughColor,
      'line-width': ['case', selected, 2, hovered, 1.6, 1],
      'line-opacity': ['case', selected, 0.95, hovered, 0.9, dimmed, 0.2, 0.6],
      'line-opacity-transition': { duration: 250 },
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
      'line-color': WATER,
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 5, 14, 13],
      'line-opacity': ['case', dimmed, 0.2, 0.75],
    },
  },
  {
    id: 'links-selected',
    type: 'line',
    source: 'links',
    filter: ['==', ['get', 'link_id'], ''],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#F2F6FA', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 8, 14, 18] },
  },
  {
    id: 'links-line',
    type: 'line',
    source: 'links',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': congestionColor,
      'line-width': width(2),
      'line-opacity': ['case', dimmed, 0.22, 1],
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
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.3, 12, 2, 15, 3.2],
      'circle-color': '#EEF4FA',
      'circle-opacity': ['case', ['get', 'dim'], 0.15, 0.9],
      'circle-pitch-alignment': 'map',
    },
  },
]

// One ring per arriving sensor reading; useReadingPulses sets p (0 -> 1 over the
// ring's life) and grow (what the radius follows; fixed for reduced motion).
const pulseAge: ExpressionSpecification = ['to-number', ['get', 'p'], 1]
const pulseFade: ExpressionSpecification = ['-', 1, pulseAge]

export const pulseLayers: LayerSpecification[] = [
  {
    id: 'reading-pulse',
    type: 'circle',
    source: 'pulses',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['to-number', ['get', 'grow'], 1], 0, 3, 1, 16],
      'circle-color': '#EEF4FA',
      'circle-opacity': ['*', pulseFade, ['case', ['get', 'dim'], 0.03, 0.14]],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#EEF4FA',
      'circle-stroke-opacity': ['*', pulseFade, ['case', ['get', 'dim'], 0.2, 0.8]],
      'circle-pitch-alignment': 'map',
    },
  },
]

export const incidentLayers: LayerSpecification[] = [
  {
    id: 'incident-ring',
    type: 'circle',
    source: 'incidents',
    paint: {
      'circle-radius': ['match', ['get', 'severity'], 'CRITICAL', 15, 'HIGH', 13, 11],
      'circle-color': 'transparent',
      'circle-stroke-width': 1.5,
      'circle-stroke-color': ['match', ['get', 'type'],
        'PERSISTENT_CONGESTION', INCIDENT_COLORS.PERSISTENT_CONGESTION,
        'SENSOR_SILENT', INCIDENT_COLORS.SENSOR_SILENT,
        INCIDENT_COLORS.SPEED_DROP],
      'circle-stroke-opacity': ['case', ['get', 'dim'], 0.2, 0.75],
    },
  },
  {
    id: 'incident-dot',
    type: 'circle',
    source: 'incidents',
    paint: {
      'circle-radius': 5,
      'circle-color': ['match', ['get', 'type'],
        'PERSISTENT_CONGESTION', INCIDENT_COLORS.PERSISTENT_CONGESTION,
        'SENSOR_SILENT', INCIDENT_COLORS.SENSOR_SILENT,
        INCIDENT_COLORS.SPEED_DROP],
      'circle-opacity': ['case', ['get', 'dim'], 0.3, 1],
      'circle-stroke-width': 2,
      'circle-stroke-color': WATER,
    },
  },
]

/** Layer groups the viewer can switch on and off. */
export const LAYER_GROUPS = {
  flow: flowLayers.map((l) => l.id),
  pulses: pulseLayers.map((l) => l.id),
  boroughs: boroughLayers.map((l) => l.id),
  incidents: incidentLayers.map((l) => l.id),
} as const

export type LayerGroup = keyof typeof LAYER_GROUPS
