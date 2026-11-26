import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActiveIncidents } from './components/ActiveIncidents'
import { BoroughStrip } from './components/BoroughStrip'
import { FlowPanel } from './components/FlowPanel'
import { Header } from './components/Header'
import { IncidentCounters } from './components/IncidentCounters'
import { IncidentFeed } from './components/IncidentFeed'
import { LinkPanel } from './components/LinkPanel'
import { MapLegend } from './components/MapLegend'
import { STEP, TimeBar } from './components/TimeBar'
import { TrafficMap } from './components/TrafficMap'
import { useLinks } from './hooks/useLinks'
import { useLiveFeed } from './hooks/useLiveFeed'
import { usePastState } from './hooks/usePastState'
import { useTimeline } from './hooks/useTimeline'
import { useBoroughShapes } from './lib/boroughs'
import type { LayerGroup } from './lib/mapLayers'

const PLAY_DELAY_MS = 120 // pause between 5-minute steps once a step has loaded

export default function App() {
  const geojson = useLinks()
  const boroughShapes = useBoroughShapes()
  const { state: live, health, onReading } = useLiveFeed()
  const timeline = useTimeline()
  const [at, setAt] = useState<number | null>(null) // null = live
  const [playing, setPlaying] = useState(false)
  const past = usePastState(at)
  // Everything below shows `state`: the live stream, or the past moment once it has loaded.
  const state = at !== null && past ? past.state : live
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusBorough, setFocusBorough] = useState<string | null>(null)
  const [hoverBorough, setHoverBorough] = useState<string | null>(null)
  const [layers, setLayers] = useState<Record<LayerGroup, boolean>>({
    flow: true, pulses: true, incidents: true, boroughs: true,
  })

  const start = timeline?.start ?? 0
  const end = Math.max(timeline?.end ?? 0, live.eventClock)

  const togglePlay = useCallback(() => {
    if (!playing && at === null) setAt(Math.ceil(start / STEP) * STEP) // from live: replay the day
    setPlaying((p) => !p)
  }, [playing, at, start])

  // Playback: step 5 minutes once the current step is on screen; at the end, go live.
  useEffect(() => {
    if (!playing || at === null || past?.at !== at) return
    const timer = window.setTimeout(() => {
      if (at + STEP >= end) {
        setAt(null)
        setPlaying(false)
      } else {
        setAt(at + STEP)
      }
    }, PLAY_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [playing, at, past, end])

  const changeTime = useCallback((t: number | null) => {
    setAt(t)
    if (t === null) setPlaying(false)
  }, [])

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
      <Header eventClock={state.eventClock} linkCount={totalLinks} reporting={reporting} health={health} past={at !== null}>
        <TimeBar
          start={start}
          end={end}
          series={timeline?.series ?? []}
          at={at}
          loading={at !== null && past?.at !== at}
          playing={playing}
          onChange={changeTime}
          onTogglePlay={togglePlay}
        />
      </Header>

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
            onReading={onReading}
            live={at === null}
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
        <FlowPanel
          boroughs={state.boroughs}
          history={state.history}
          links={state.links}
          silent={state.silent}
          readingsTotal={state.readingsTotal}
          lateTotal={state.lateTotal}
        />
        <IncidentCounters counts={state.counts} />
        <ActiveIncidents
          active={state.active}
          eventClock={state.eventClock}
          focus={focusBorough}
          onClearFocus={clearFocus}
          onSelect={setSelectedId}
        />
        <IncidentFeed incidents={state.recent} focus={focusBorough} onClearFocus={clearFocus} onSelect={setSelectedId} />
      </aside>
    </div>
  )
}
