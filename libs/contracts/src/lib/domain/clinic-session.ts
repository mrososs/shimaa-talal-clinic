import type { ClinicSessionKind } from './clinic-session-kind';
import type { ClinicSessionStatus } from './clinic-session-status';
import type { DoctorPresence } from './doctor-presence';
import type { IsoDate, IsoInstant } from './temporal';

/**
 * One concrete half-day of clinic operation.
 *
 * This is the join between Booking and Queue that lets neither depend on the
 * other: Booking reads a session's capacity to compute availability, Queue
 * writes its operational state, and the session owns the things that belong to
 * a day rather than to a patient — the ticket counter, the doctor's presence,
 * whether the queue is running at all.
 */
export interface ClinicSession {
  id: string;
  clinicId: string;
  doctorMemberId: string;

  /** The clinic-local day this session belongs to. */
  sessionDate: IsoDate;
  sessionKind: ClinicSessionKind;

  plannedStart: IsoInstant;
  plannedEnd: IsoInstant;
  expectedStartAt: IsoInstant | null;
  doctorArrivedAt: IsoInstant | null;
  expectedResumeAt: IsoInstant | null;

  /** Length of one arrival window, in minutes. */
  windowMinutes: number;
  /** How many patients may book one arrival window. */
  capacityPerWindow: number;

  status: ClinicSessionStatus;

  doctorPresence: DoctorPresence;
  /** How far behind, when staff have said. `null` means they have not. */
  delayMinutes: number | null;
  delayNote: string | null;

  /**
   * Staff's current estimate of a consultation's length, adjustable during the
   * day. Feeds a *coarse* waiting estimate — never a ticking countdown.
   */
  avgConsultMinutes: number;

  /**
   * Increments on every queue mutation. A poll may send it back and be told
   * "nothing changed" instead of re-fetching the board.
   */
  revision: number;
  bookingRevision: number;
}

/** The subset a parent may see. Carries nothing about other patients. */
export interface ParentSessionView {
  status: ClinicSessionStatus;
  doctorPresence: DoctorPresence;
  delayMinutes: number | null;
  avgConsultMinutes: number;
  revision: number;
}
