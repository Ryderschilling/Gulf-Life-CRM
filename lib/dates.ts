// ============================================================
// lib/dates.ts — ONE source of truth for every date comparison.
// The business runs on US Central time (America/Chicago), so
// "today", "this month", and "overdue" always mean that local
// calendar — never the server's timezone and never raw UTC.
// Works on server and client; zero dependencies.
// ============================================================

export const CRM_TZ = 'America/Chicago'

/** YYYY-MM-DD for a date in CRM-local time.
 *  Date-only strings (and exact-UTC-midnight timestamps — which is how a
 *  date-only value comes back from Postgres) pass through unchanged: they
 *  encode a calendar date, not an instant, so timezone-shifting them would
 *  move the date back a day for anyone west of UTC. */
export function localDateStr(input?: string | Date | null): string {
  if (typeof input === 'string') {
    const m = input.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T ]00:00:00(?:\.0+)?(?:Z|\+00(?::00)?)?$)/)
    if (m) return m[1]
  }
  const d = input ? new Date(input) : new Date()
  return d.toLocaleDateString('en-CA', { timeZone: CRM_TZ })
}

/** Today's date (YYYY-MM-DD) in CRM-local time. */
export function todayStr(): string {
  return localDateStr()
}

/** UTC instant for a CRM-local wall-clock time on a given date.
 *  Probes both Central offsets so DST is handled without a tz library. */
export function localTimeToISO(dateStr: string, time = '09:00:00'): string {
  for (const off of ['-05:00', '-06:00']) {
    const d = new Date(`${dateStr}T${time}${off}`)
    if (localDateStr(d) === dateStr) return d.toISOString()
  }
  return new Date(`${dateStr}T${time}-06:00`).toISOString()
}

/** First instant of today, CRM-local — use for "overdue" DB queries (< this). */
export function startOfTodayISO(): string {
  return localTimeToISO(todayStr(), '00:00:00.000')
}

/** Last instant of today, CRM-local — use for "due today or earlier" DB queries (<= this). */
export function endOfTodayISO(): string {
  return localTimeToISO(todayStr(), '23:59:59.999')
}

/** First instant of the current CRM-local calendar month. */
export function startOfMonthISO(): string {
  return localTimeToISO(`${todayStr().slice(0, 7)}-01`, '00:00:00.000')
}

/** Same CRM-local calendar month as today? */
export function isThisLocalMonth(date: string | Date | null | undefined): boolean {
  if (!date) return false
  return localDateStr(date).slice(0, 7) === todayStr().slice(0, 7)
}

/** The follow-up rule, everywhere:
 *  due date < today → 'overdue' · = today → 'today' · > today → 'upcoming'.
 *  Dates compared as CRM-local calendar days, never clock times. */
export function followUpStatus(due: string | Date | null | undefined): 'overdue' | 'today' | 'upcoming' | null {
  if (!due) return null
  const d = localDateStr(due)
  const t = todayStr()
  if (d < t) return 'overdue'
  if (d === t) return 'today'
  return 'upcoming'
}

/** Whole CRM-local calendar days a date is past today (0 = due today, negative = future). */
export function daysOverdue(due: string | Date): number {
  const [dy, dm, dd] = localDateStr(due).split('-').map(Number)
  const [ty, tm, td] = todayStr().split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(dy, dm - 1, dd)) / 86400000)
}

/** "Good morning" / "Good afternoon" / "Good evening" by the CRM-local clock. */
export function timeOfDayGreeting(): string {
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: CRM_TZ, hour: 'numeric', hour12: false })) % 24
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}
