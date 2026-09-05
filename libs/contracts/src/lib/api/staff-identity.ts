import type { GuardianChild } from '../domain/child';
import type { Guardian } from '../domain/guardian';
import type { IsoInstant } from '../domain/temporal';

/**
 * `GET /clinic/guardians/:id` — a family, as reception works with it.
 *
 * Guardian and children together, because that is one screen and one decision:
 * who is calling, and which of their children the visit is for.
 *
 * Operational identity only. No diagnoses, prescriptions, notes, vaccinations
 * or payments — those are a medical and a financial record, and this platform
 * holds neither.
 */
export interface GuardianDetail {
  guardian: Guardian;
  children: GuardianChild[];
}

/**
 * `POST /clinic/guardians/:id/claim-code` — a code for a parent to type in.
 *
 * The plaintext exists in this response and nowhere else. It is not stored, not
 * retrievable, and not recoverable from what is stored, so a staff member who
 * loses it issues a new one rather than looking the old one up.
 */
export interface IssuedClaimCode {
  code: string;
  expiresAt: IsoInstant;
}
