/** Shows which borough a list is narrowed to, with a way back to all. */
export function FocusChip({ borough, onClear }: { borough: string; onClear: () => void }) {
  return (
    <button
      type="button"
      className="focus-chip"
      onClick={onClear}
      aria-label={`Show all boroughs (now ${borough} only)`}
      title="Show all boroughs"
    >
      {borough} only
      <svg className="focus-chip__x" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2 2 L8 8 M8 2 L2 8" />
      </svg>
    </button>
  )
}
