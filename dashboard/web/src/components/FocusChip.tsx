import { boroughColor } from '../lib/boroughs'

/** Shows which borough a list is narrowed to, with a way back to all. */
export function FocusChip({ borough, onClear }: { borough: string; onClear: () => void }) {
  return (
    <button
      type="button"
      className="focus-chip"
      style={{ '--borough': boroughColor(borough) } as React.CSSProperties}
      onClick={onClear}
      aria-label={`Show all boroughs (now ${borough})`}
    >
      <span className="focus-chip__key" aria-hidden="true" />
      {borough}
      <span aria-hidden="true" className="focus-chip__x">×</span>
    </button>
  )
}
