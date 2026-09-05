import type { IsoInstant } from './temporal';

/**
 * A period the clinic is not seeing patients: a holiday, a break, an absence.
 *
 * Instants rather than a weekday and a time, unlike a schedule, because a
 * closure is a specific absence — half of them are entered as "from now until
 * four".
 *
 * A closure subtracts windows from availability. It deliberately does *not*
 * cancel appointments already booked: those are people who were told a time,
 * and staff decide what to do about each one.
 */
export interface ClinicClosure {
  id: string;
  clinicId: string;
  /** `null` closes the whole clinic rather than one doctor's list. */
  doctorMemberId: string | null;
  startsAt: IsoInstant;
  endsAt: IsoInstant;
  reason: string;
}
