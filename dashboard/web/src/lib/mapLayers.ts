// MapLibre sources and layers for the road links and the incident markers.
// Colors are data-driven through *feature state*: the map component calls
// setFeatureState(link, { ratio, silent }) whenever a new window arrives.
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl'
import { INCIDENT_COLORS, LEVELS, NO_DATA_COLOR, SILENT_COLOR } from './levels'

export const BASEMAP = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

const color = (level: string) => LEVELS.find((l) => l.level === level)!.color
const ratio: ExpressionSpecification = ['to-number', ['feature-state', 'ratio'], 1]

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
    id: 'links-selected',
    type: 'line',
    source: 'links',
    filter: ['==', ['get', 'link_id'], ''],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#F4F6F2', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 7, 14, 16] },
  },
  {
    id: 'links-glow',
    type: 'line',
    source: 'links',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': congestionColor, 'line-width': width(6), 'line-blur': 6, 'line-opacity': 0.35 },
  },
  {
    id: 'links-line',
    type: 'line',
    source: 'links',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': congestionColor, 'line-width': width(2.2) },
  },
  {
    // invisible wide line that makes thin links easy to hover and click
    id: 'links-hit',
    type: 'line',
    source: 'links',
    paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 },
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
      'circle-stroke-opacity': 0.7,
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
      'circle-stroke-width': 2,
      'circle-stroke-color': '#14191E',
    },
  },
]
