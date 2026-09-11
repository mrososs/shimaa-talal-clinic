import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router';
import type { SessionStore } from '@clinic/client-session';
import type { MeResponse } from '@clinic/contracts';

/**
 * Where a signed-in parent is allowed to be.
 *
 * There are three states, and confusing them is the classic bug in this kind of
 * app: not signed in, signed in but not yet a guardian, and a guardian with no
 * children. Each has exactly one destination, and this is the only place that
 * decision is made — a screen never redirects on its own.
 *
 * Written for vue-router 5, where a guard *returns* its answer. `next()` still
 * exists but is deprecated, and mixing the two styles is how guards silently
 * stop firing.
 */

export const ROUTE_META_PUBLIC = 'public';
export const ROUTE_META_GUEST = 'guest';
export const ROUTE_META_ONBOARDING = 'onboarding';
export const ROUTE_META_PASSWORD_RECOVERY = 'passwordRecovery';

export interface AuthGuardDeps {
  session: SessionStore<MeResponse>;
  /** Resolved once; the guard awaits the same promise on every navigation. */
  ready: () => Promise<void>;
}

export function createAuthGuard({ session, ready }: AuthGuardDeps) {
  return async function authGuard(
    to: RouteLocationNormalized,
  ): Promise<RouteLocationRaw | true> {
    // Capability links are intentionally independent of Supabase Auth. Do not
    // make a waiting-room guest bootstrap a session before they can see a turn.
    if (to.meta[ROUTE_META_GUEST] === true) return true;

    // The first navigation happens before the stored session has been read.
    // Deciding without waiting would bounce a returning parent to the login
    // screen for a frame and then correct itself, which looks like a bug and
    // loses a deep link.
    await ready();

    const isPublic = to.meta[ROUTE_META_PUBLIC] === true;
    const isOnboarding = to.meta[ROUTE_META_ONBOARDING] === true;
    const isPasswordRecovery = to.meta[ROUTE_META_PASSWORD_RECOVERY] === true;
    const { status, identity } = session.state;

    if (status !== 'authenticated') {
      return isPublic ? true : { name: 'sign-in' };
    }

    // A recovery link establishes a short-lived authenticated session before
    // routing here. It must remain reachable long enough to set the password.
    if (isPasswordRecovery) return true;

    // Signed in: the ordinary auth screens are no longer somewhere to be.
    if (isPublic) {
      return { name: 'home' };
    }

    if (identity === null) {
      // Authenticated, but the clinic identity could not be read — the API is
      // unreachable or refused. Onboarding cannot proceed without it, so let
      // the screen render its own retry rather than redirect in a circle.
      return true;
    }

    if (identity.guardian === null) {
      // A clinic identity does not exist yet. This is a normal new account,
      // not an error.
      return isOnboarding ? true : { name: 'onboarding-guardian' };
    }

    if (identity.children.length === 0) {
      // A guardian with no children cannot book anything, so the app would be
      // an empty shell. Send them to add one — but let them reach the claim
      // screen, which is how a family that reception already knows arrives
      // here with children attached.
      return isOnboarding ? true : { name: 'onboarding-child' };
    }

    // Fully set up: onboarding is behind them.
    return isOnboarding ? { name: 'home' } : true;
  };
}
