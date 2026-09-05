/**
 * Rule violations this library reports to its caller.
 *
 * Not HTTP exceptions: the domain does not know it is behind HTTP, and these
 * are equally meaningful to a workflow or a test. The API layer maps `code` to
 * a status and to the failure envelope.
 *
 * Only *expected* outcomes appear here. A database being unreachable is not a
 * domain error and propagates as itself.
 */
export const ClinicErrorCode = {
  ClinicNotFound: 'clinic_not_found',
  SessionNotFound: 'session_not_found',

  /**
   * The session is closed, and closing is final.
   *
   * Reopening a closed day would resurrect a queue that staff deliberately
   * emptied, so it is refused rather than silently allowed.
   */
  SessionClosed: 'session_closed',

  /** The clinic runs no session of that shape on that date. */
  NoScheduleForDate: 'no_schedule_for_date',
} as const;

export type ClinicErrorCode =
  (typeof ClinicErrorCode)[keyof typeof ClinicErrorCode];

export class ClinicError extends Error {
  constructor(
    readonly code: ClinicErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'ClinicError';
  }
}
