// New York wall-clock arithmetic for the time bar (the data is New York time,
// the viewer may be anywhere). NYC offsets are whole hours, so UTC hour
// boundaries are New York hour boundaries too.
export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
})

function wallClock(ms: number) {
  const p: Record<string, number> = {}
  for (const { type, value } of parts.formatToParts(ms)) p[type] = Number(value)
  return p
}

/** Milliseconds New York is ahead of UTC at `ms` (negative, e.g. -4 h in summer). */
function offset(ms: number) {
  const p = wallClock(ms)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

/** New York hour of day (0-23) at `ms`. */
export const nyHour = (ms: number) => wallClock(ms).hour

/** `hour:minute` New York time on the New York day that contains `ms`. */
export function nyTimeOnDayOf(ms: number, hour: number, minute: number) {
  const p = wallClock(ms)
  const wall = Date.UTC(p.year, p.month - 1, p.day, hour, minute)
  const guess = wall - offset(wall)
  return wall - offset(guess) // second pass settles DST days
}

/** The latest moment at or before `end` that was `hour:minute` in New York. */
export function latestOccurrence(end: number, hour: number, minute: number) {
  const today = nyTimeOnDayOf(end, hour, minute)
  return today <= end ? today : nyTimeOnDayOf(end - DAY, hour, minute)
}
