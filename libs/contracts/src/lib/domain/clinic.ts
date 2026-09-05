import type { IsoDate } from './temporal';

/**
 * A tenant. Every other entity in these contracts carries a `clinicId`.
 *
 * The pilot runs one clinic; the model does not assume it always will. What is
 * here is the policy a client genuinely needs in order to render honestly —
 * how long a grace period lasts, whether a parent's booking is a request or a
 * booking — not the clinic's full configuration.
 */
export interface Clinic {
  id: string;
  name: string;
  slug: string;

  /** IANA zone, e.g. `Africa/Cairo`. The clinic's day boundary, not the server's. */
  timezone: string;

  /** ISO 3166-1 alpha-2, e.g. `EG`. The region `@clinic/phone` normalises against. */
  defaultCountryCode: string;

  /** How long a called patient has to reach the room before staff may skip them. */
  gracePeriodMinutes: number;

  /** How many times a parent may defer their own turn in one day. */
  maxSelfDefers: number;

  /**
   * When false, a parent's booking lands as `requested` and a staff member
   * approves it. Clients read this to word the confirm button — "Request" or
   * "Book" — instead of guessing.
   */
  autoConfirmParentBookings: boolean;

  /** Today, in the clinic's timezone. Saves every client re-deriving it. */
  today: IsoDate;
}
