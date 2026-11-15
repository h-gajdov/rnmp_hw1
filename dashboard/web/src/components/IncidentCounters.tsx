import { INCIDENT_LABELS } from '../lib/levels'
import type { IncidentType } from '../types'
import { IncidentIcon } from './IncidentIcon'

const ORDER: IncidentType[] = ['SPEED_DROP', 'PERSISTENT_CONGESTION', 'RECOVERY', 'SENSOR_SILENT']

export function IncidentCounters({ counts }: { counts: Record<IncidentType, number> }) {
  return (
    <section aria-label="Alerts by type">
      <ul className="counters">
        {ORDER.map((type) => (
          <li key={type} className="counter">
            <IncidentIcon type={type} />
            <b className="counter__n">{counts[type]}</b>
            <span className="counter__label">{INCIDENT_LABELS[type]}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
