// Map legend that doubles as a live summary: how many links are at each level.
import { LEVELS, NO_DATA_COLOR, SILENT_COLOR } from '../lib/levels'
import type { Incident, LinkStats } from '../types'

interface Props {
  totalLinks: number
  links: Record<string, LinkStats>
  silent: Record<string, Incident>
}

export function NetworkSummary({ totalLinks, links, silent }: Props) {
  const counts = Object.fromEntries(LEVELS.map((l) => [l.level, 0]))
  for (const s of Object.values(links)) if (!(s.link_id in silent)) counts[s.level] += 1
  const silentCount = Object.keys(silent).length
  const noData = Math.max(0, totalLinks - Object.values(counts).reduce((a, b) => a + b, 0) - silentCount)

  const rows = [
    ...LEVELS.map((l) => ({ key: l.level, label: l.label, color: l.color, n: counts[l.level] })),
    { key: 'SILENT', label: 'Sensor silent', color: SILENT_COLOR, n: silentCount },
    { key: 'NONE', label: 'No data', color: NO_DATA_COLOR, n: noData },
  ].filter((r) => r.n > 0 || LEVELS.some((l) => l.level === r.key))

  return (
    <section className="network" aria-label="Road segments by congestion level">
      <div className="network__bar">
        {rows.map((r) => r.n > 0 && (
          <span key={r.key} style={{ flexGrow: r.n, background: r.color }} title={`${r.label}: ${r.n}`} />
        ))}
      </div>
      <ul className="network__legend">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="swatch" style={{ background: r.color }} />
            <span>{r.label}</span>
            <b>{r.n}</b>
          </li>
        ))}
      </ul>
      <p className="caption">Speed as a share of each road’s free-flow speed: 75% and up is free flow, under 30% is severe.</p>
    </section>
  )
}
