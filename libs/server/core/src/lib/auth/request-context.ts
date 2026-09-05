import type { AuthenticatedUser } from './authenticated-user';
import type { ClinicMemberContext } from './clinic-member-resolver';
import type { GuardianContext } from './guardian-resolver';

/**
 * Who the caller is, in clinic terms, for the duration of one request.
 *
 * Populated by `RolesGuard` and read through `@CurrentGuardian()` /
 * `@CurrentMember()`. Only what the route actually required is resolved: a
 * staff route does not go looking for a guardian, and vice versa.
 */
export interface RequestContext {
  authUser: AuthenticatedUser;

  /** Resolved only when the route requires the guardian role. */
  guardian: GuardianContext | null;

  /** Resolved only when the route requires a staff role. */
  member: ClinicMemberContext | null;

  /**
   * The tenant this request acts within, from the token — never from the
   * request body. `null` only when the route required neither identity.
   */
  clinicId: string | null;
}
