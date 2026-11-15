// Map legend that doubles as a live summary (how many links are at each
// level) and holds the switches for the optional map layers.
import { LEVELS, NO_DATA_COLOR, SILENT_COLOR } from '../lib/levels'
import type { LayerGroup } from '../lib/mapLayers'
import type { Incident, LinkStats } from '../types'

interface Props {
  totalLinks: number
  links: Record<string, LinkStats>
  silent: Record<string, Incident>
  layers: Record<LayerGroup, boolean>
  onToggle: (group: LayerGroup) => void
}

const SWITCHES: { group: LayerGroup; label: string; hint: string }[] = [
  { group: 'flow', label: 'Traffic flow', hint: 'Dots move along each road at its measured speed' },
  { group: 'incidents', label: 'Incidents', hint: 'Open incidents and silent sensors' },
  { group: 'boroughs', label: 'Boroughs', hint: 'Borough areas; click one to focus it' },
]

export function MapLegend({ totalLinks, links, silent, layers, onToggle }: Props) {
  const counts = Object.fromEntries(LEVELS.map((l) => [l.level, 0]))
  for (const s of Object.values(links)) if (!(s.link_id in silent)) counts[s.level] += 1
  const silentCount = Object.keys(silent).length
  const noData = Math.max(0, totalLinks - Object.values(counts).reduce((a, b) => a + b, 0) - silentCount)

  const rows = [
    ...LEVELS.map((l) => ({ key: l.level, label: l.label, color: l.color, n: counts[l.level] })),
    { key: 'SILENT', label: 'Silent sensor', color: SILENT_COLOR, n: silentCount },
    { key: 'NONE', label: 'No data', color: NO_DATA_COLOR, n: noData },
  ]

  return (
    <section className="legend" aria-label="Map legend and layers">
      <h2 className="legend__title">Road segments by congestion</h2>
      <div className="legend__bar" aria-hidden="true">
        {rows.map((r) => r.n > 0 && (
          <span key={r.key} style={{ flexGrow: r.n, background: r.color }} title={`${r.label}: ${r.n}`} />
        ))}
      </div>
      <ul className="legend__rows">
        {rows.map((r) => (
          <li key={r.key} className={r.n === 0 ? 'is-zero' : undefined}>
            <span className="swatch" style={{ background: r.color }} />
            <span>{r.label}</span>
            <b>{r.n}</b>
          </li>
        ))}
      </ul>
      <p className="legend__note">Speed as a share of free flow: 75% and up is free, under 30% is severe.</p>

      <ul className="legend__switches">
        {SWITCHES.map((s) => (
          <li key={s.group}>
            <label className="switch" title={s.hint}>
              <input type="checkbox" checked={layers[s.group]} onChange={() => onToggle(s.group)} />
              <span className="switch__track" aria-hidden="true" />
              <span>{s.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}
