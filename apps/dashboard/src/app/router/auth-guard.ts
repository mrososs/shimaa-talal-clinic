import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router';
import type { SessionStore } from '@clinic/client-session';
import { type ClinicMeResponse, type ClinicMemberRole } from '@clinic/contracts';

/**
 * Who may reach which staff screen.
 *
 * Two separate questions, and they fail differently. *Signed in* sends you to
 * the login page. *Signed in without a clinic membership* does not — that
 * account is perfectly valid, it simply belongs to a parent, and bouncing it to
 * login produces a loop. It reaches the shell, which says so.
 *
 * The role check here is convenience, not security. Every rule it expresses is
 * enforced again in the API, and that is the copy that matters: hiding a button
 * is not the same as refusing the request behind it.
 */

export const ROUTE_META_PUBLIC = 'public';
export const ROUTE_META_ROLES = 'roles';

export interface AuthGuardDeps {
  session: SessionStore<ClinicMeResponse>;
  ready: () => Promise<void>;
}

export function createAuthGuard({ session, ready }: AuthGuardDeps) {
  return async function authGuard(
    to: RouteLocationNormalized,
  ): Promise<RouteLocationRaw | true> {
    await ready();

    const isPublic = to.meta[ROUTE_META_PUBLIC] === true;
    const { status, identity } = session.state;

    if (status !== 'authenticated') {
      return isPublic ? true : { name: 'sign-in' };
    }

    if (isPublic) {
      return { name: 'overview' };
    }

    // No membership resolved. The shell renders the reason — "no clinic
    // access", or a retry if the API was simply unreachable.
    if (identity === null) {
      return true;
    }

    const allowed = to.meta[ROUTE_META_ROLES] as
      | readonly ClinicMemberRole[]
      | undefined;

    if (allowed !== undefined && !allowed.includes(identity.member.role)) {
      // A doctor who deep-links into a reception-only screen lands somewhere
      // real instead of on an error.
      return { name: 'overview' };
    }

    return true;
  };
}
