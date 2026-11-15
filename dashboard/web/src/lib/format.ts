// Event times are epoch ms; the data is from New York, so show New York time.
const TZ = 'America/New_York'

const clock = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const day = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

export const formatClock = (ms: number) => clock.format(ms)
export const formatDay = (ms: number) => day.format(ms)

const shortDay = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
export const formatShortDay = (ms: number) => shortDay.format(ms)

export const formatMph = (mph: number) => `${mph.toFixed(1)} mph`

export const formatPercent = (share: number) => `${Math.round(share * 100)}%`

export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

const ACRONYMS = new Set(['NYST'])

/** Title-case the all-caps DOT link names but keep road codes:
 *  "CBE E TAYLOR AVENUE" -> "CBE E Taylor Avenue". */
export function prettyLinkName(name: string) {
  const keep = (w: string) => w.length <= 3 || /[\d-]/.test(w) || ACRONYMS.has(w) || w !== w.toUpperCase()
  return name
    .split(' ')
    .map((w) => (keep(w) ? w : w[0] + w.slice(1).toLowerCase()))
    .join(' ')
}
