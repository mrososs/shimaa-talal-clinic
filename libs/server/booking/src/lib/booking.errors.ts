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
export const BookingErrorCode = {
  AppointmentNotFound: 'appointment_not_found',

  /**
   * The window filled between reading availability and submitting.
   *
   * The expected outcome of a race, not a fault. The response carries fresh
   * availability so the screen can offer the next option rather than failing.
   */
  SlotUnavailable: 'slot_unavailable',

  /** No such window in that session, or the session is closed. */
  SessionUnavailable: 'session_unavailable',

  /** The window has started, or is inside the clinic's booking cutoff. */
  WindowInPast: 'window_in_past',

  /** The state machine forbids it — approving something already cancelled. */
  InvalidTransition: 'invalid_transition',

  /** Too close to the window for a parent to call it off themselves. */
  CancellationTooLate: 'cancellation_too_late',

  /** The child is not one this guardian may act for. */
  ChildNotAccessible: 'child_not_accessible',
} as const;

export type BookingErrorCode =
  (typeof BookingErrorCode)[keyof typeof BookingErrorCode];

export class BookingError extends Error {
  constructor(
    readonly code: BookingErrorCode,
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
    this.name = 'BookingError';
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
