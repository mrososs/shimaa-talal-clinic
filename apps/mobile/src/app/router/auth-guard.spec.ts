import { describe, expect, it, vi } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';
import type { SessionStore } from '@clinic/client-session';
import type { MeResponse } from '@clinic/contracts';
import {
  ROUTE_META_ONBOARDING,
  ROUTE_META_PASSWORD_RECOVERY,
  ROUTE_META_PUBLIC,
  createAuthGuard,
} from './auth-guard';

/**
 * The guard is the only thing that decides where a parent lands, so the matrix
 * it implements is the thing worth testing — not that a page renders.
 */

type State = SessionStore<MeResponse>['state'];

function storeWith(state: Partial<State>): SessionStore<MeResponse> {
  return {
    state: {
      status: 'anonymous',
      session: null,
      identity: null,
      pending: false,
      authError: null,
      identityError: null,
      ...state,
    },
  } as SessionStore<MeResponse>;
}

function identity(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    authUserId: 'user-1',
    email: 'parent@example.test',
    clinic: { id: 'clinic-1' },
    guardian: null,
    children: [],
    ...overrides,
  } as MeResponse;
}

function route(
  name: string,
  meta: Record<string, unknown> = {},
): RouteLocationNormalized {
  return { name, meta, path: `/${name}` } as unknown as RouteLocationNormalized;
}

const publicRoute = route('sign-in', { [ROUTE_META_PUBLIC]: true });
const onboardingRoute = route('onboarding-guardian', {
  [ROUTE_META_ONBOARDING]: true,
});
const homeRoute = route('home');
const recoveryRoute = route('update-password', {
  [ROUTE_META_PASSWORD_RECOVERY]: true,
});

function guardFor(session: SessionStore<MeResponse>) {
  return createAuthGuard({ session, ready: async () => undefined });
}

describe('mobile auth guard', () => {
  it('waits for the session to be resolved before deciding', async () => {
    // Deciding early bounces a returning parent to login for a frame and loses
    // the deep link they arrived on.
    const order: string[] = [];
    const session = storeWith({ status: 'anonymous' });
    const guard = createAuthGuard({
      session,
      ready: async () => {
        order.push('ready');
      },
    });

    await guard(homeRoute);
    order.push('decided');

    expect(order).toEqual(['ready', 'decided']);
  });

  it('awaits bootstrap once per navigation without re-running it', async () => {
    const ready = vi.fn(async () => undefined);
    const session = storeWith({ status: 'anonymous' });
    const guard = createAuthGuard({ session, ready });

    await guard(homeRoute);
    await guard(publicRoute);

    // The router calls the guard on every navigation; memoising belongs to the
    // caller, and the guard must simply await whatever it is handed.
    expect(ready).toHaveBeenCalledTimes(2);
  });

  describe('not signed in', () => {
    it('sends a protected route to sign-in', async () => {
      const guard = guardFor(storeWith({ status: 'anonymous' }));
      expect(await guard(homeRoute)).toEqual({ name: 'sign-in' });
    });

    it('lets the auth screens through', async () => {
      const guard = guardFor(storeWith({ status: 'anonymous' }));
      expect(await guard(publicRoute)).toBe(true);
    });

    it('sends onboarding to sign-in too', async () => {
      // Onboarding is not public: there is nothing to onboard without an
      // account to attach it to.
      const guard = guardFor(storeWith({ status: 'anonymous' }));
      expect(await guard(onboardingRoute)).toEqual({ name: 'sign-in' });
    });

    it('rejects a recovery route when its link did not establish a session', async () => {
      const guard = guardFor(storeWith({ status: 'anonymous' }));
      expect(await guard(recoveryRoute)).toEqual({ name: 'sign-in' });
    });

    it('treats a still-restoring session as not signed in', async () => {
      const guard = guardFor(storeWith({ status: 'restoring' }));
      expect(await guard(homeRoute)).toEqual({ name: 'sign-in' });
    });
  });

  describe('signed in, no guardian yet', () => {
    const session = storeWith({
      status: 'authenticated',
      identity: identity({ guardian: null }),
    });

    it('sends the app to onboarding', async () => {
      expect(await guardFor(session)(homeRoute)).toEqual({
        name: 'onboarding-guardian',
      });
    });

    it('lets onboarding through', async () => {
      expect(await guardFor(session)(onboardingRoute)).toBe(true);
    });

    it('keeps a signed-in user off the auth screens', async () => {
      expect(await guardFor(session)(publicRoute)).toEqual({ name: 'home' });
    });

    it('allows a valid password-recovery session to set the new password', async () => {
      expect(await guardFor(session)(recoveryRoute)).toBe(true);
    });
  });

  describe('guardian with no children', () => {
    const session = storeWith({
      status: 'authenticated',
      identity: identity({
        guardian: { id: 'g1' } as MeResponse['guardian'],
        children: [],
      }),
    });

    it('sends the app to the child screen', async () => {
      // A guardian with no children cannot book anything, so home would be an
      // empty shell.
      expect(await guardFor(session)(homeRoute)).toEqual({
        name: 'onboarding-child',
      });
    });

    it('still allows the claim screen', async () => {
      // Claiming is how a family reception already knows arrives here with
      // children attached — it must not be blocked by having none yet.
      const claim = route('onboarding-claim', {
        [ROUTE_META_ONBOARDING]: true,
      });
      expect(await guardFor(session)(claim)).toBe(true);
    });
  });

  describe('fully set up', () => {
    const session = storeWith({
      status: 'authenticated',
      identity: identity({
        guardian: { id: 'g1' } as MeResponse['guardian'],
        children: [{ id: 'c1' } as MeResponse['children'][number]],
      }),
    });

    it('allows home', async () => {
      expect(await guardFor(session)(homeRoute)).toBe(true);
    });

    it('sends onboarding back home', async () => {
      expect(await guardFor(session)(onboardingRoute)).toEqual({
        name: 'home',
      });
    });

    it('sends the auth screens back home', async () => {
      expect(await guardFor(session)(publicRoute)).toEqual({ name: 'home' });
    });
  });

  describe('signed in but the identity could not be read', () => {
    it('renders the page instead of redirecting in a circle', async () => {
      // The API is unreachable or refused. Onboarding cannot proceed without an
      // identity, and redirecting would loop — so the screen shows its own
      // retry.
      const session = storeWith({
        status: 'authenticated',
        identity: null,
        identityError: 'unavailable',
      });
      expect(await guardFor(session)(homeRoute)).toBe(true);
    });
  });
});
