import { INCIDENT_LABELS } from '../lib/levels'
import type { IncidentType } from '../types'
import { IncidentIcon } from './IncidentIcon'

const ORDER: IncidentType[] = ['SPEED_DROP', 'PERSISTENT_CONGESTION', 'RECOVERY', 'SENSOR_SILENT']

/** Alerts emitted since the bridge started, per type: one line of four. */
export function IncidentCounters({ counts }: { counts: Record<IncidentType, number> }) {
  return (
    <dl className="counters" aria-label="Alerts by type since the bridge started">
      {ORDER.map((type) => (
        <div key={type} className="counter">
          <dt className="counter__label">
            <IncidentIcon type={type} size={14} />
            {INCIDENT_LABELS[type]}
          </dt>
          <dd className="counter__n">{counts[type]}</dd>
        </div>
      ))}
    </dl>
  )
}
