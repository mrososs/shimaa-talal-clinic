import { arabicDigits } from './numerals';

/**
 * Times and ages, in the clinic's own timezone.
 *
 * The zone is always passed in, never defaulted to the browser's. A
 * receptionist on a laptop still set to another country must read the same
 * board as the one beside her, and a clinic day is a fact about Cairo.
 */

export function timeLabel(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(instant));
}

/** An arrival window, as the family was told it: "١٠:٠٠ – ١١:٠٠". */
export function windowLabel(
  start: string,
  end: string,
  timezone: string,
): string {
  return `${timeLabel(start, timezone)} – ${timeLabel(end, timezone)}`;
}

/**
 * How long ago, in words, for the "updated N seconds ago" line.
 *
 * Coarse on purpose. The board is polled every five seconds and a ticking
 * second counter would draw the eye to the one number on the screen that does
 * not matter.
 */
export function agoLabel(at: number | null, now: number): string | null {
  if (at === null) return null;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 10) return 'الآن';
  if (seconds < 60) return `منذ ${arabicDigits(seconds)} ثانية`;
  return `منذ ${arabicDigits(Math.round(seconds / 60))} دقيقة`;
}

/**
 * A child's age, the way a clinic says it.
 *
 * Months under two years, because "٨ أشهر" and "سنة وشهران" are the units a
 * paediatric clinic actually works in — "٠.٧ سنة" is not something anyone says.
 */
export function ageLabel(dateOfBirth: string | null): string | null {
  if (dateOfBirth === null) return null;

  const born = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;

  const now = new Date();
  let months =
    (now.getUTCFullYear() - born.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - born.getUTCMonth());
  if (now.getUTCDate() < born.getUTCDate()) months -= 1;
  if (months < 0) return null;

  if (months < 24) {
    return months === 0
      ? 'أقل من شهر'
      : `${arabicDigits(months)} ${months <= 10 ? 'أشهر' : 'شهراً'}`;
  }

  const years = Math.floor(months / 12);
  return `${arabicDigits(years)} ${years <= 10 ? 'سنوات' : 'سنة'}`;
}
