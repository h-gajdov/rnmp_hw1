import { INCIDENT_LABELS } from '../lib/levels'
import type { IncidentType } from '../types'
import { IncidentIcon } from './IncidentIcon'

const ORDER: IncidentType[] = ['SPEED_DROP', 'PERSISTENT_CONGESTION', 'RECOVERY', 'SENSOR_SILENT']

/** Alerts emitted since the bridge started, per type. */
export function IncidentCounters({ counts }: { counts: Record<IncidentType, number> }) {
  return (
    <section className="counters" aria-label="Alerts by type since the bridge started">
      {ORDER.map((type) => (
        <div key={type} className="counter">
          <span className="counter__top">
            <IncidentIcon type={type} size={16} />
            <b className="counter__n">{counts[type]}</b>
          </span>
          <span className="counter__label">{INCIDENT_LABELS[type]}</span>
        </div>
      ))}
    </section>
  )
}
