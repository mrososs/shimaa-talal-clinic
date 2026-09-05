/**
 * States a patient's place in the live clinic queue can be in.
 *
 * Six states carry roughly a dozen screens, because three things the design
 * shows as statuses are not domain states at all:
 *
 *   - **arrived** is presentation. A queue entry exists *because* the patient
 *     arrived, so `Waiting` already says it.
 *   - **late** is derived. The arrival window has passed and no entry exists —
 *     a fact about the clock, not something anyone sets.
 *   - **urgent** is orthogonal. A patient can be urgent *and* waiting *and*
 *     called, so it is a flag on the entry, not a value here.
 *
 * Nor is there a `grace_period` state: `Called` carries a `graceExpiresAt`
 * deadline, and whether it has lapsed is a comparison, not a status.
 *
 * The queue *algorithm* — serving order, grace, missed turns, emergency
 * insertion, doctor delays — belongs to `libs/server/queue`.
 */
export const QueueStatus = {
  Waiting: 'waiting',
  /** Announced. The grace period is running. */
  Called: 'called',
  InService: 'in_service',
  /** Called, did not come. Can be requeued with a new ticket number. */
  Missed: 'missed',
  Done: 'done',
  /** Removed by staff, or the backing appointment was cancelled. */
  Cancelled: 'cancelled',
} as const;

export type QueueStatus = (typeof QueueStatus)[keyof typeof QueueStatus];
