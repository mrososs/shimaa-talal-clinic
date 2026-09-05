import { arabicDigits } from './numerals';

/**
 * How dates and windows are worded, in one place.
 *
 * Every one of these is rendered in the clinic's timezone, not the device's. A
 * parent looking at their phone in another country must still see the hour the
 * clinic means — and around midnight the two disagree about the *day*, not just
 * the hour.
 */

const TIMEZONE = 'Africa/Cairo';

/** "السبت ١٢ يونيو" */
export function dayLabel(iso: string, timeZone = TIMEZONE): string {
  return new Intl.DateTimeFormat('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date(iso));
}

/** "١٢ يونيو" — for a compact card. */
export function shortDayLabel(iso: string, timeZone = TIMEZONE): string {
  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date(iso));
}

/** "١٠:٠٠ ص" */
export function timeLabel(iso: string, timeZone = TIMEZONE): string {
  return new Intl.DateTimeFormat('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

/**
 * "١٠:٠٠ – ١١:٠٠ ص" — a range, which is what the clinic actually promises.
 *
 * Never a single minute. The queue orders by when people arrive, so a precise
 * appointment time would be a promise the queue does not keep.
 */
export function windowLabel(
  start: string,
  end: string,
  timeZone = TIMEZONE,
): string {
  return `${timeLabel(start, timeZone)} – ${timeLabel(end, timeZone)}`;
}

/** "متاح ٣ من ٥" */
export function remainingLabel(remaining: number, capacity: number): string {
  return `متاح ${arabicDigits(remaining)} من ${arabicDigits(capacity)}`;
}

/** The clinic-local calendar date for an instant, as `YYYY-MM-DD`. */
export function clinicDate(date: Date, timeZone = TIMEZONE): string {
  // `en-CA` because it formats as YYYY-MM-DD, which is the shape the API takes.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}
