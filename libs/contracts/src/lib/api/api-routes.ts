/**
 * The API's addressing convention, declared once.
 *
 * The NestJS bootstrap reads the prefix and version to configure its global
 * prefix and URI versioning; the frontend `ApiClient` reads them to build its
 * base URL. Neither side hardcodes `/api/v1`.
 *
 * The segments below are used the same way in both directions — NestJS puts
 * them in its `@Controller` and `@Post` decorators, clients build paths from
 * them — so a rename is a compile error rather than a 404 found in testing.
 */

export const API_PREFIX = 'api';

/** Current major version. URI versioning renders this as `/api/v1`. */
export const API_VERSION = '1';

export const API_BASE_PATH = `/${API_PREFIX}/v${API_VERSION}`;

/**
 * Top-level resources, relative to `API_BASE_PATH`.
 *
 * `Clinic` is the staff prefix: everything under it resolves the acting member
 * and their clinic from the token. Everything outside it is either a parent's
 * own data (`Me`, `Appointments`, `Queue`) or open (`Health`).
 */
export const ApiResource = {
  Health: 'health',
  Me: 'me',
  Children: 'children',
  Appointments: 'appointments',
  Booking: 'booking',
  Queue: 'queue',
  Clinic: 'clinic',
  Guardians: 'guardians',
  Sessions: 'sessions',
  Messages: 'messages',
  UrgentCases: 'urgent-cases',
  Payments: 'payments',
  Reports: 'reports',
  Availability: 'availability',
} as const;

export type ApiResource = (typeof ApiResource)[keyof typeof ApiResource];

/**
 * Command sub-paths.
 *
 * Lifecycle transitions are named commands rather than a `PATCH` carrying a
 * target status. Each has its own preconditions, its own authorisation rule and
 * its own audit entry; a generic `PATCH` would let a client name an illegal
 * state and would push a `switch` on status into the controller.
 */
export const ApiCommand = {
  Cancel: 'cancel',
  Reschedule: 'reschedule',
  Approve: 'approve',
  Reject: 'reject',
  NoShow: 'no-show',
  CheckIn: 'check-in',

  WalkIn: 'walk-in',
  CallNext: 'call-next',
  Call: 'call',
  Start: 'start',
  Complete: 'complete',
  Miss: 'miss',
  Requeue: 'requeue',
  Emergency: 'emergency',
  Move: 'move',
  Defer: 'defer',

  Open: 'open',
  Pause: 'pause',
  Resume: 'resume',
  Close: 'close',
  DoctorPresence: 'doctor-presence',
  Pace: 'pace',

  Claim: 'claim',
  ClaimRequest: 'claim-request',
  ClaimCode: 'claim-code',
  Refund: 'refund',
} as const;

export type ApiCommand = (typeof ApiCommand)[keyof typeof ApiCommand];
