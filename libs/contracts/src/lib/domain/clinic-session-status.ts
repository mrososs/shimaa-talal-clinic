/**
 * The operational state of one clinic session.
 *
 * This gates the queue: `call next` and `check in` are refused unless the
 * session is `Open`. `Paused` is the receptionist's "hold on" — the queue keeps
 * its order and its patients, it simply stops advancing.
 */
export const ClinicSessionStatus = {
  /** Materialised from the weekly schedule, not yet running. */
  Scheduled: 'scheduled',
  Open: 'open',
  Paused: 'paused',
  Closed: 'closed',
} as const;

export type ClinicSessionStatus =
  (typeof ClinicSessionStatus)[keyof typeof ClinicSessionStatus];
