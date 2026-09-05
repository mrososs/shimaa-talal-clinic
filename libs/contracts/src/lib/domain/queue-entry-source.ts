/**
 * Where a queue entry came from.
 *
 * Both are ordinary entries with equal standing. A walk-in is not a degraded
 * appointment and no appointment row is fabricated for one — the Queue Engine
 * must work for a patient who has no booking, no app and no account.
 */
export const QueueEntrySource = {
  /** Created by checking in an existing appointment. */
  Appointment: 'appointment',
  /** Registered at reception with no booking. */
  WalkIn: 'walk_in',
} as const;

export type QueueEntrySource =
  (typeof QueueEntrySource)[keyof typeof QueueEntrySource];
