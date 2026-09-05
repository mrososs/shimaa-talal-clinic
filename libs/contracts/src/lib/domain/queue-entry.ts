import type { ChildSummary } from './child';
import type { GuardianSummary } from './guardian';
import type { QueueEntrySource } from './queue-entry-source';
import type { QueueStatus } from './queue-status';
import type { IsoInstant } from './temporal';

/**
 * A patient's place in today's live queue.
 *
 * Created at check-in or walk-in registration — never in advance for a future
 * appointment. `appointmentId` is null for a walk-in, and that is an ordinary
 * case rather than an exception.
 *
 * Two fields the server keeps to itself: the sort key that decides service
 * order, and the numeric priority behind `isEmergency`. Both are ordering
 * mechanics, and a client that could see them would be tempted to sort with
 * them. Order is the server's answer, delivered as the order of the array.
 */
export interface QueueEntry {
  id: string;
  clinicId: string;
  sessionId: string;

  /** `null` for a walk-in. */
  appointmentId: string | null;
  childId: string;
  guardianId: string | null;

  source: QueueEntrySource;

  /**
   * The number the patient is told — "رقمك ٢٤". Assigned at check-in and
   * immutable thereafter.
   *
   * It is **not** a position. Reordering and emergency insertion change who is
   * served next without changing anyone's number, so `ticketNumber` minus the
   * number being served is not the count of people ahead. Use `aheadCount`.
   */
  ticketNumber: number;

  status: QueueStatus;

  /** Served ahead of the ordinary queue. Set by staff, always with a reason. */
  isEmergency: boolean;

  visitReason: string | null;

  checkedInAt: IsoInstant;
  calledAt: IsoInstant | null;

  /**
   * When this patient's grace runs out, set the moment they are called.
   *
   * Nothing expires on a timer — no scheduler runs. Staff act, and the API
   * validates against this deadline. Whether grace has lapsed is
   * `now > graceExpiresAt`, derived, never a stored status.
   */
  graceExpiresAt: IsoInstant | null;

  startedAt: IsoInstant | null;
  completedAt: IsoInstant | null;

  /** How many times the parent has deferred their own turn today. */
  deferCount: number;
}

/** A queue entry with the identity a staff board has to show. */
export interface QueueBoardEntry extends QueueEntry {
  child: ChildSummary;
  guardian: GuardianSummary | null;
  emergencyReason: string | null;
}

/**
 * What a parent may see about their own child's turn.
 *
 * Note what is missing: no other patient, no other ticket number, no name, no
 * list. A parent gets a count and their own row, because that is all they need
 * and everything else is someone else's medical business.
 */
export interface ParentQueueEntry {
  id: string;
  ticketNumber: number;
  status: QueueStatus;

  /**
   * How many patients are ahead of this one right now. Counted by the server
   * from the real service order, so it stays correct after a reorder, an
   * emergency insertion or a deferral.
   *
   * Zero once the turn is no longer pending — a finished or missed entry has
   * nobody ahead of it, and a number left over from when it was waiting would
   * be read as one.
   */
  aheadCount: number;

  /** When the clinic called this patient. `null` until they are called. */
  calledAt: IsoInstant | null;

  /**
   * The deadline the clinic promised when it called them.
   *
   * A real instant, so a screen may count down to it exactly. It is the only
   * countdown in the parent app that is allowed to tick — see
   * `estimatedWaitMinutes` for why the other one may not.
   */
  graceExpiresAt: IsoInstant | null;

  /**
   * A coarse band, in minutes, or `null`.
   *
   * Null whenever the clinic cannot honestly estimate: the doctor has not
   * arrived, the session is not running, or the turn is not pending. The rule
   * lives here rather than in the app because it is a promise the clinic makes,
   * and a client deriving it from `avgConsultMinutes` would eventually make
   * that promise in a state where the clinic would not.
   *
   * Deliberately a range and never a countdown. A ticking "17:42 remaining" is
   * a commitment the clinic cannot keep, and a parent reads it as one while
   * driving.
   */
  estimatedWaitMinutes: WaitEstimate | null;

  deferCount: number;
  isEmergency: boolean;
}

/** A range, in minutes. Always shown as a range, never as a single number. */
export interface WaitEstimate {
  from: number;
  to: number;
}
