/**
 * Rule violations this domain reports to its caller.
 *
 * Not HTTP exceptions: the domain does not know it is behind HTTP, and these
 * are equally meaningful to a workflow or a test. The API layer maps `code` to
 * a status and to the failure envelope.
 *
 * Only *expected* outcomes appear here. A database being unreachable is not a
 * domain error and propagates as itself.
 */
export const QueueErrorCode = {
  EntryNotFound: 'queue_entry_not_found',

  /** Invalid, expired and revoked guest links intentionally share one answer. */
  GuestLinkUnavailable: 'queue_guest_link_unavailable',

  /**
   * Somebody else moved first.
   *
   * Two staff pressing Call Next at the same moment: one wins, and the other
   * gets this with the current board attached so their screen can self-heal
   * rather than sit on a stale view.
   */
  Conflict: 'queue_conflict',

  /** The move is not legal from where this entry is now. */
  InvalidTransition: 'queue_invalid_transition',

  /** The session is closed, or paused, and the queue is not advancing. */
  SessionNotRunning: 'queue_session_not_running',

  /** Nobody is waiting. */
  QueueEmpty: 'queue_empty',

  /** Calling another patient cannot end an active consultation implicitly. */
  CurrentPatientStillInService: 'queue_current_patient_still_in_service',

  /** The child or guardian-child relationship is outside this clinic. */
  ChildNotAccessible: 'queue_child_not_accessible',

  /**
   * Marking a patient missed before their grace has run out.
   *
   * Refused rather than silently allowed, because the deadline is the promise
   * the clinic made when it called them. Staff can override with a reason.
   */
  GraceNotExpired: 'queue_grace_not_expired',

  /** The parent has used their deferrals for the day. */
  DeferLimitReached: 'queue_defer_limit_reached',

  /** An emergency without a reason is an emergency nobody can explain later. */
  ReasonRequired: 'queue_reason_required',
} as const;

export type QueueErrorCode =
  (typeof QueueErrorCode)[keyof typeof QueueErrorCode];

export class QueueError extends Error {
  constructor(
    readonly code: QueueErrorCode,
    message: string,
    cause?: unknown,
    /**
     * Extra the client can act on — never anything about the failure itself.
     *
     * `cause` holds the driver error and stays server-side; this is a
     * deliberately constructed payload, so nothing can carry a constraint name
     * or a query into a response by accident.
     */
    readonly details?: unknown,
  ) {
    super(message, { cause });
    this.name = 'QueueError';
  }
}

/** Postgres unique-violation. The only driver code this domain interprets. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  if (candidate.code !== UNIQUE_VIOLATION) return false;
  return constraint === undefined || candidate.constraint === constraint;
}
