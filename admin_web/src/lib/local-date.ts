/**
 * Calendar keys in the viewer's own time zone.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC day, not today: in New
 * York after 8 p.m. it is already tomorrow, so a date picker floored at it
 * refuses the evening's own date, and east of Greenwich it lets through a day
 * that has already ended. Every "today", "tomorrow" or "in N days" a form
 * offers or floors at comes from here.
 */

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** "YYYY-MM-DD" for the local calendar day `date` falls on. */
export function localDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The local day `days` calendar days after `from` (DST-safe: it moves the
 * calendar, not a fixed 24-hour count). */
export function localDateKeyInDays(days: number, from: Date = new Date()): string {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days, 12);
  return localDateKey(date);
}

/** "YYYY-MM-DDTHH:MM" in local time, the value a `datetime-local` box takes. */
export function localDateTimeKey(date: Date = new Date()): string {
  return `${localDateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
