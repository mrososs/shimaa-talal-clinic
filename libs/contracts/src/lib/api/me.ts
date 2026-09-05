import type { Clinic } from '../domain/clinic';
import type { ClinicMember } from '../domain/clinic-member';
import type { Guardian } from '../domain/guardian';
import type { GuardianChild } from '../domain/child';

/**
 * `GET /me` — everything the mobile app needs to decide what to render first.
 *
 * `guardian` is `null` for a signed-in user who has not completed onboarding,
 * which is how the app knows to route there instead of to home. It is a normal
 * state, not an error: an auth account and a clinic identity are separate
 * things, and one can exist without the other.
 */
export interface MeResponse {
  authUserId: string;
  email: string | null;
  clinic: Clinic;
  guardian: Guardian | null;
  children: GuardianChild[];
}

/** `GET /clinic/me` — the staff equivalent. */
export interface ClinicMeResponse {
  authUserId: string;
  email: string | null;
  clinic: Clinic;
  member: ClinicMember;
}

/**
 * `POST /me/guardian/claim-request` — "do you already know me?"
 *
 * Deliberately carries nothing but a boolean. Returning a name or a child count
 * would turn an unauthenticated guess at a phone number into a way to read a
 * family's details, so a match and a non-match are indistinguishable apart from
 * this flag — and a phone already claimed by someone else reports `false`.
 */
export interface ClaimRequestResponse {
  matchFound: boolean;
}
