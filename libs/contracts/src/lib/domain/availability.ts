import type { ClinicSessionKind } from './clinic-session-kind';
import type { IsoDate, IsoInstant } from './temporal';

/**
 * One bookable arrival window.
 *
 * The clinic tells a parent a range — "10:00 to 11:00" — not a minute. Queue
 * order comes from when the patient actually arrives, so a precise appointment
 * time would be a promise the queue does not keep.
 *
 * Capacity is the real constraint, and it is enforced by a unique index in
 * PostgreSQL, not by this number. Treat `remaining` as advisory: it is true
 * when it was computed, and a booking can still lose a race to the last seat.
 * Clients must handle that conflict rather than trusting the count.
 */
export interface AvailabilityWindow {
  sessionId: string;
  sessionKind: ClinicSessionKind;

  windowStart: IsoInstant;
  windowEnd: IsoInstant;

  capacity: number;
  taken: number;
  remaining: number;
}

/** Windows grouped by clinic-local day, which is how every day-picker renders them. */
export interface AvailabilityDay {
  date: IsoDate;
  windows: AvailabilityWindow[];
}
