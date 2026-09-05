/**
 * Lifecycle states an appointment can be in.
 *
 * The vocabulary lives here so the mobile app, the dashboard and the API can
 * never drift apart on what "confirmed" means. The *rules* that move an
 * appointment between these states belong to `libs/server/booking` and are
 * deliberately not implemented yet.
 *
 * Naming a state is not the same as asserting what causes it. In particular
 * `CheckedIn` does **not** imply that checking in creates a queue entry, and no
 * state here implies anything about payment: an appointment has a payment state
 * and may have a queue entry, but Booking, Queue and Payments are separate
 * engines. See docs/cross-domain-orchestration.md.
 */
export const AppointmentStatus = {
  Requested: 'requested',
  Confirmed: 'confirmed',
  CheckedIn: 'checked_in',
  Completed: 'completed',
  Cancelled: 'cancelled',
  NoShow: 'no_show',
} as const;

export type AppointmentStatus =
  (typeof AppointmentStatus)[keyof typeof AppointmentStatus];
