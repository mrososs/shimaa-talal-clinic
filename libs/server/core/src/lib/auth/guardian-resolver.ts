/**
 * The seam between an authenticated user and the family they act for.
 *
 * Declared here, implemented in `libs/server/patients`, bound in `apps/api` —
 * the same inversion `TOKEN_VERIFIER` uses, and for the same reason:
 * `server-core` is `scope:shared` and may not depend on a domain, but the
 * authorisation layer has to ask a domain who this caller is.
 */

/**
 * The minimum needed to authorise a request. Deliberately not the `Guardian`
 * DTO from `@clinic/contracts`: this is read on every guarded parent request,
 * and it should not make the database load a name and a phone number to answer
 * a yes/no question.
 */
export interface GuardianContext {
  id: string;
  clinicId: string;
}

export interface GuardianResolver {
  /** `null` when the user has not completed onboarding — a normal state. */
  resolveByAuthUserId(authUserId: string): Promise<GuardianContext | null>;
}

export const GUARDIAN_RESOLVER = Symbol('GUARDIAN_RESOLVER');
