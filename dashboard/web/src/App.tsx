import { useCallback, useMemo, useState } from 'react'
import { ActiveIncidents } from './components/ActiveIncidents'
import { BoroughStrip } from './components/BoroughStrip'
import { FlowPanel } from './components/FlowPanel'
import { Header } from './components/Header'
import { IncidentFeed } from './components/IncidentFeed'
import { LinkPanel } from './components/LinkPanel'
import { MapLegend } from './components/MapLegend'
import { TrafficMap } from './components/TrafficMap'
import { useLinks } from './hooks/useLinks'
import { useLiveFeed } from './hooks/useLiveFeed'
import { useBoroughShapes } from './lib/boroughs'
import type { LayerGroup } from './lib/mapLayers'

export default function App() {
  const geojson = useLinks()
  const boroughShapes = useBoroughShapes()
  const { state, health } = useLiveFeed()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusBorough, setFocusBorough] = useState<string | null>(null)
  const [hoverBorough, setHoverBorough] = useState<string | null>(null)
  const [layers, setLayers] = useState<Record<LayerGroup, boolean>>({ flow: true, incidents: true, boroughs: true })

  const toggleLayer = useCallback((group: LayerGroup) => setLayers((l) => ({ ...l, [group]: !l[group] })), [])
  const clearFocus = useCallback(() => setFocusBorough(null), [])

  const totalLinks = geojson?.features.length ?? 0
  const reporting = Object.keys(state.links).filter((id) => !(id in state.silent)).length
  const selected = selectedId ? geojson?.features.find((f) => f.properties.link_id === selectedId) : undefined
  const boroughNow = useMemo(
    () => Object.fromEntries(Object.entries(state.boroughs).map(([name, s]) => [name, s[s.length - 1]])),
    [state.boroughs],
  )

  return (
    <div className="app">
      <Header
        eventClock={state.eventClock}
        linkCount={totalLinks}
        reporting={reporting}
        health={health}
        active={state.active}
        onSelect={setSelectedId}
      />

      <main className="stage">
        {geojson ? (
          <TrafficMap
            geojson={geojson}
            boroughShapes={boroughShapes}
            boroughNow={boroughNow}
            links={state.links}
            active={state.active}
            silent={state.silent}
            selectedId={selectedId}
            onSelect={setSelectedId}
            focusBorough={focusBorough}
            onFocusBorough={setFocusBorough}
            hoverBorough={hoverBorough}
            onHoverBorough={setHoverBorough}
            layers={layers}
          />
        ) : (
          <div className="map map--loading">
            <p>Loading road geometry. The producer writes data/links.geojson on its first start.</p>
          </div>
        )}
        <MapLegend
          totalLinks={totalLinks}
          links={state.links}
          silent={state.silent}
          layers={layers}
          onToggle={toggleLayer}
        />
        {selected && (
          <LinkPanel
            feature={selected}
            stats={state.links[selected.properties.link_id]}
            history={state.history[selected.properties.link_id] ?? []}
            incidents={state.recent.filter((i) => i.link_id === selectedId)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </main>

      <BoroughStrip
        boroughs={state.boroughs}
        active={state.active}
        focus={focusBorough}
        hover={hoverBorough}
        onFocus={setFocusBorough}
        onHover={setHoverBorough}
      />

      <aside className="side">
        <FlowPanel boroughs={state.boroughs} history={state.history} links={state.links} silent={state.silent} />
        <ActiveIncidents
          active={state.active}
          eventClock={state.eventClock}
          focus={focusBorough}
          onClearFocus={clearFocus}
          onSelect={setSelectedId}
        />
        <IncidentFeed
          incidents={state.recent}
          counts={state.counts}
          focus={focusBorough}
          onClearFocus={clearFocus}
          onSelect={setSelectedId}
        />
      </aside>
    </div>
  )
}
