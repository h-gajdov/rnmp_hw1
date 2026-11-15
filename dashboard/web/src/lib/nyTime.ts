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

/** `hour:minute` New York time on the New York day that contains `ms`. */
export function nyTimeOnDayOf(ms: number, hour: number, minute: number) {
  const p = wallClock(ms)
  const wall = Date.UTC(p.year, p.month - 1, p.day, hour, minute)
  const guess = wall - offset(wall)
  return wall - offset(guess) // second pass settles DST days
}


/** New York midnight that starts the day containing `ms`. */
export const nyDayStart = (ms: number) => nyTimeOnDayOf(ms, 0, 0)

/** New York midnight after the day that starts at `dayStart` (23 or 25 h later on DST days). */
export const nyNextDay = (dayStart: number) => nyTimeOnDayOf(dayStart + 30 * HOUR, 0, 0)

/** Starts of every New York day touched by [start, end]. */
export function nyDays(start: number, end: number) {
  const days: number[] = []
  for (let d = nyDayStart(start); d <= end; d = nyNextDay(d)) days.push(d)
  return days
}

/** The same New York time of day as `ms`, on the day that starts at `dayStart`. */
export function sameTimeOnDay(ms: number, dayStart: number) {
  const p = wallClock(ms)
  return nyTimeOnDayOf(dayStart, p.hour, p.minute)
}
