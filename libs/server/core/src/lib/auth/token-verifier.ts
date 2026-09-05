import type { AuthenticatedUser } from './authenticated-user';

/**
 * The seam between "a bearer token arrived" and "we know who this is".
 *
 * Declared as an interface + injection token so the verification strategy
 * (Supabase today; possibly local JWKS verification later) can change without
 * touching a single domain module.
 */
export interface TokenVerifier {
  /** Resolves the user, or `null` when the token is absent/invalid/expired. */
  verify(accessToken: string): Promise<AuthenticatedUser | null>;
}

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');
