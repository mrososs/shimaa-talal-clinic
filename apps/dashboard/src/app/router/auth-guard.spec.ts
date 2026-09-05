import { describe, expect, it } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';
import type { SessionStore } from '@clinic/client-session';
import { ClinicMemberRole, type ClinicMeResponse } from '@clinic/contracts';
import {
  ROUTE_META_PUBLIC,
  ROUTE_META_ROLES,
  createAuthGuard,
} from './auth-guard';

/**
 * Two failures that look alike and must not behave alike: not signed in, and
 * signed in as somebody with no clinic membership.
 */

type State = SessionStore<ClinicMeResponse>['state'];

function storeWith(state: Partial<State>): SessionStore<ClinicMeResponse> {
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
  } as SessionStore<ClinicMeResponse>;
}

function identityAs(role: ClinicMemberRole): ClinicMeResponse {
  return {
    authUserId: 'user-1',
    email: 'staff@example.test',
    clinic: { id: 'clinic-1' },
    member: { id: 'm1', clinicId: 'clinic-1', role, status: 'active' },
  } as ClinicMeResponse;
}

function route(
  name: string,
  meta: Record<string, unknown> = {},
): RouteLocationNormalized {
  return { name, meta, path: `/${name}` } as unknown as RouteLocationNormalized;
}

function guardFor(session: SessionStore<ClinicMeResponse>) {
  return createAuthGuard({ session, ready: async () => undefined });
}

const signIn = route('sign-in', { [ROUTE_META_PUBLIC]: true });
const overview = route('overview');
const receptionOnly = route('guardians', {
  [ROUTE_META_ROLES]: [ClinicMemberRole.Reception, ClinicMemberRole.Admin],
});

describe('dashboard auth guard', () => {
  it('sends an anonymous visitor to sign-in', async () => {
    expect(await guardFor(storeWith({}))(overview)).toEqual({
      name: 'sign-in',
    });
  });

  it('lets an anonymous visitor reach sign-in', async () => {
    expect(await guardFor(storeWith({}))(signIn)).toBe(true);
  });

  it('treats a still-restoring session as not signed in', async () => {
    const session = storeWith({ status: 'restoring' });
    expect(await guardFor(session)(overview)).toEqual({ name: 'sign-in' });
  });

  it('keeps a signed-in member off the sign-in screen', async () => {
    const session = storeWith({
      status: 'authenticated',
      identity: identityAs(ClinicMemberRole.Reception),
    });
    expect(await guardFor(session)(signIn)).toEqual({ name: 'overview' });
  });

  it('lets a parent account into the shell rather than looping', async () => {
    // Signed in, no membership. Bouncing to sign-in produces a loop, because
    // the credentials are correct and would simply sign them in again.
    const session = storeWith({
      status: 'authenticated',
      identity: null,
      identityError: 'forbidden',
    });
    expect(await guardFor(session)(overview)).toBe(true);
  });

  it('lets an unreachable API into the shell, which offers a retry', async () => {
    const session = storeWith({
      status: 'authenticated',
      identity: null,
      identityError: 'unavailable',
    });
    expect(await guardFor(session)(overview)).toBe(true);
  });

  describe('role-restricted screens', () => {
    it('admits the roles a screen names', async () => {
      const session = storeWith({
        status: 'authenticated',
        identity: identityAs(ClinicMemberRole.Reception),
      });
      expect(await guardFor(session)(receptionOnly)).toBe(true);
    });

    it('redirects a doctor away from a reception-only screen', async () => {
      const session = storeWith({
        status: 'authenticated',
        identity: identityAs(ClinicMemberRole.Doctor),
      });
      expect(await guardFor(session)(receptionOnly)).toEqual({
        name: 'overview',
      });
    });

    it('leaves unrestricted screens open to every role', async () => {
      const session = storeWith({
        status: 'authenticated',
        identity: identityAs(ClinicMemberRole.Doctor),
      });
      expect(await guardFor(session)(overview)).toBe(true);
    });
  });
});
