import type { AppointmentStatus } from './appointment-status';
import type { ChildSummary } from './child';
import type { GuardianSummary } from './guardian';
import type { IsoInstant } from './temporal';
import type { VisitType } from './visit-type';

/** Who called the visit off. Distinguishes a clinic rejection from a parent cancelling. */
export const AppointmentCancelledBy = {
  Parent: 'parent',
  Clinic: 'clinic',
} as const;

export type AppointmentCancelledBy =
  (typeof AppointmentCancelledBy)[keyof typeof AppointmentCancelledBy];

/**
 * A booked visit.
 *
 * Owned by Booking, and carrying nothing from Queue or Payments: an appointment
 * *has* a queue entry at most once and *may* have payments, but it drives
 * neither. `checked_in` is the one place the two touch, and it means only that
 * a queue entry now exists.
 *
 * The seat number that enforces capacity is deliberately absent. Exposing it
 * would let a client render a minute-level time and quietly turn an arrival
 * window back into an appointment slot.
 */
export interface Appointment {
  id: string;
  clinicId: string;
  sessionId: string;
  childId: string;
  guardianId: string;

  windowStart: IsoInstant;
  windowEnd: IsoInstant;

  visitType: VisitType;
  status: AppointmentStatus;
  notes: string | null;

  /** `null` when the parent booked it themselves. */
  createdByMemberId: string | null;

  cancelledAt: IsoInstant | null;
  cancelledBy: AppointmentCancelledBy | null;
  cancellationReason: string | null;

  /** Set when this appointment replaced an earlier one, so the trail survives. */
  rescheduledFromAppointmentId: string | null;

  createdAt: IsoInstant;
}

/** An appointment with the names a staff list has to show. */
export interface AppointmentListItem extends Appointment {
  child: ChildSummary;
  guardian: GuardianSummary;

  /**
   * Derived, never stored: the arrival window has passed and no queue entry
   * exists. "Late" is a fact about the clock, not a state anyone sets.
   */
  isLate: boolean;
}

/** The subset a parent sees on their own live-queue card. */
export interface ParentAppointmentSummary {
  id: string;
  status: AppointmentStatus;
  windowStart: IsoInstant;
  windowEnd: IsoInstant;
  visitType: VisitType;
}
