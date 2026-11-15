import { useState } from 'react'
import { ActiveIncidents } from './components/ActiveIncidents'
import { BoroughStrip } from './components/BoroughStrip'
import { Gantry } from './components/Gantry'
import { IncidentCounters } from './components/IncidentCounters'
import { IncidentFeed } from './components/IncidentFeed'
import { LinkPanel } from './components/LinkPanel'
import { NetworkSummary } from './components/NetworkSummary'
import { TrafficMap } from './components/TrafficMap'
import { useLinks } from './hooks/useLinks'
import { useLiveFeed } from './hooks/useLiveFeed'

export default function App() {
  const geojson = useLinks()
  const { state, health } = useLiveFeed()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const totalLinks = geojson?.features.length ?? 0
  const selected = selectedId ? geojson?.features.find((f) => f.properties.link_id === selectedId) : undefined

  return (
    <div className="app">
      <Gantry eventClock={state.eventClock} linkCount={totalLinks} health={health} />

      <main className="stage">
        {geojson ? (
          <TrafficMap
            geojson={geojson}
            links={state.links}
            active={state.active}
            silent={state.silent}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ) : (
          <div className="map map--loading">
            <p>Loading road geometry. The producer writes data/links.geojson on its first start.</p>
          </div>
        )}
        <NetworkSummary totalLinks={totalLinks} links={state.links} silent={state.silent} />
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

      <aside className="side">
        <IncidentCounters counts={state.counts} />
        <ActiveIncidents active={state.active} eventClock={state.eventClock} onSelect={setSelectedId} />
        <IncidentFeed incidents={state.recent} onSelect={setSelectedId} />
      </aside>

      <BoroughStrip boroughs={state.boroughs} />
    </div>
  )
}
