/**
 * Whether the doctor has arrived for a session.
 *
 * This belongs to the *session*, not to a queue entry. Storing "doctor is late"
 * on every waiting patient would mean writing the same fact many times and
 * getting it wrong at least once.
 *
 * It is the honest input to what a parent is told: the app says the queue has
 * not started because the doctor has not arrived, rather than quietly counting
 * down to a turn that cannot come.
 */
export const DoctorPresence = {
  /** Before the session opens — no claim made either way. */
  Expected: 'expected',
  Arrived: 'arrived',
  /** On the way, running behind. */
  EnRoute: 'en_route',
  /** Has not arrived and the session was due to start. */
  NotArrived: 'not_arrived',
} as const;

export type DoctorPresence =
  (typeof DoctorPresence)[keyof typeof DoctorPresence];
