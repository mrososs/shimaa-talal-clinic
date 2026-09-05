import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@clinic/api-client';
import {
  AuthError,
  type AuthProvider,
  type AuthSession,
} from '@clinic/client-auth';
import { createSessionStore } from './session-store';

/**
 * The store decides what every screen renders, so the cases that matter are the
 * ones where "signed in" and "known to the clinic" disagree.
 */

const session: AuthSession = {
  accessToken: 'token',
  userId: 'user-1',
  expiresAt: null,
};

interface Identity {
  name: string;
}

const identity: Identity = { name: 'Umm Leen' };

function stubProvider(overrides: Partial<AuthProvider> = {}): {
  auth: AuthProvider;
  emit: (session: AuthSession | null) => void;
  unsubscribe: () => void;
} {
  let listener: (session: AuthSession | null) => void = () => undefined;
  const unsubscribe = vi.fn();

  const auth: AuthProvider = {
    getSession: async () => null,
    getAccessToken: async () => null,
    restoreSession: async () => null,
    signInWithPassword: async () => session,
    signUp: async () => ({ session, needsEmailConfirmation: false }),
    onAuthStateChange: (next) => {
      listener = next;
      return unsubscribe;
    },
    signOut: async () => undefined,
    ...overrides,
  };

  const store = { auth, emit: (s: AuthSession | null) => listener(s), unsubscribe };
  return store;
}

describe('createSessionStore', () => {
  describe('bootstrap', () => {
    it('settles on anonymous when nothing is stored', async () => {
      const { auth } = stubProvider();
      const store = createSessionStore({
        auth,
        loadIdentity: async () => identity,
      });

      expect(store.state.status).toBe('restoring');
      await store.bootstrap();

      expect(store.state.status).toBe('anonymous');
      expect(store.state.identity).toBeNull();
    });

    it('restores a session and the identity behind it', async () => {
      const { auth } = stubProvider({ restoreSession: async () => session });
      const store = createSessionStore({
        auth,
        loadIdentity: async () => identity,
      });

      await store.bootstrap();

      expect(store.state.status).toBe('authenticated');
      expect(store.state.session).toEqual(session);
      expect(store.state.identity).toEqual(identity);
    });

    it('treats a failed restore as anonymous, not as an error screen', async () => {
      // A parent opening the app on a bad connection has done nothing wrong.
      const { auth } = stubProvider({
        restoreSession: async () => {
          throw new AuthError('network', 'offline');
        },
      });
      const store = createSessionStore({
        auth,
        loadIdentity: async () => identity,
      });

      await store.bootstrap();
      expect(store.state.status).toBe('anonymous');
    });
  });

  describe('identity', () => {
    it('stays signed in when the account has no access here', async () => {
      // A parent signing into the dashboard. Signing them out would drop them
      // at a login screen that lets them straight back in, forever.
      const { auth } = stubProvider({ restoreSession: async () => session });
      const signOut = vi.spyOn(auth, 'signOut');
      const store = createSessionStore({
        auth,
        loadIdentity: async () => {
          throw new ApiClientError(403, {
            code: 'forbidden',
            message: 'no access',
          });
        },
      });

      await store.bootstrap();

      expect(store.state.status).toBe('authenticated');
      expect(store.state.identityError).toBe('forbidden');
      expect(signOut).not.toHaveBeenCalled();
    });

    it('signs out when the token is no longer accepted', async () => {
      const { auth } = stubProvider({ restoreSession: async () => session });
      const store = createSessionStore({
        auth,
        loadIdentity: async () => {
          throw new ApiClientError(401, {
            code: 'unauthenticated',
            message: 'expired',
          });
        },
      });

      await store.bootstrap();

      expect(store.state.status).toBe('anonymous');
      expect(store.state.session).toBeNull();
    });

    it('separates an unreachable API from a refusal', async () => {
      const { auth } = stubProvider({ restoreSession: async () => session });
      const store = createSessionStore({
        auth,
        loadIdentity: async () => {
          throw new Error('network down');
        },
      });

      await store.bootstrap();
      expect(store.state.identityError).toBe('unavailable');
      expect(store.state.status).toBe('authenticated');
    });

    it('re-reads the identity on demand, which is how onboarding completes', async () => {
      const { auth } = stubProvider({ restoreSession: async () => session });
      let current: Identity | null = null;
      const store = createSessionStore({
        auth,
        loadIdentity: async () => {
          if (current === null) throw new Error('not yet');
          return current;
        },
      });

      await store.bootstrap();
      expect(store.state.identity).toBeNull();

      current = identity;
      await store.refreshIdentity();
      expect(store.state.identity).toEqual(identity);
      expect(store.state.identityError).toBeNull();
    });

    it('does not fetch an identity while anonymous', async () => {
      const { auth } = stubProvider();
      const loadIdentity = vi.fn(async () => identity);
      const store = createSessionStore({ auth, loadIdentity });

      await store.bootstrap();
      await store.refreshIdentity();

      expect(loadIdentity).not.toHaveBeenCalled();
    });
  });

  describe('sign in', () => {
    it('reports the credential failure in the app’s own vocabulary', async () => {
      const { auth } = stubProvider({
        signInWithPassword: async () => {
          throw new AuthError('invalid_credentials', 'Invalid login');
        },
      });
      const store = createSessionStore({
        auth,
        loadIdentity: async () => identity,
      });

      const ok = await store.signIn({ email: 'a@b.test', password: 'wrong' });

      expect(ok).toBe(false);
      expect(store.state.authError).toBe('invalid_credentials');
      expect(store.state.status).toBe('restoring');
      expect(store.state.pending).toBe(false);
    });

    it('clears the previous failure when a new attempt starts', async () => {
      let fail = true;
      const { auth } = stubProvider({
        signInWithPassword: async () => {
          if (fail) throw new AuthError('invalid_credentials', 'nope');
          return session;
        },
      });
      const store = createSessionStore({
        auth,
        loadIdentity: async () => identity,
      });

      await store.signIn({ email: 'a@b.test', password: 'wrong' });
      expect(store.state.authError).toBe('invalid_credentials');

      fail = false;
      expect(await store.signIn({ email: 'a@b.test', password: 'right' })).toBe(
        true,
      );
      expect(store.state.authError).toBeNull();
      expect(store.state.identity).toEqual(identity);
    });

    it('marks itself pending while in flight, so the button can disable', async () => {
      let release: (() => void) | undefined;
      const { auth } = stubProvider({
        signInWithPassword: async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return session;
        },
      });
      const store = createSessionStore({
        auth,
        loadIdentity: async () => identity,
      });

      const inFlight = store.signIn({ email: 'a@b.test', password: 'pw' });
      await Promise.resolve();
      expect(store.state.pending).toBe(true);

      release?.();
      await inFlight;
      expect(store.state.pending).toBe(false);
    });
  });

  describe('sign up', () => {
    it('routes into the app when a session is issued', async () => {
      const { auth } = stubProvider();
      const store = createSessionStore({
        auth,
        loadIdentity: async () => identity,
      });

      expect(await store.signUp({ email: 'a@b.test', password: 'pw' })).toBe(
        true,
      );
      expect(store.state.status).toBe('authenticated');
    });

    it('refuses to route when the project requires confirmation', async () => {
      // Supabase answers this way for an existing address too, deliberately, so
      // the screen must say "check your email" rather than "account created".
      const { auth } = stubProvider({
        signUp: async () => ({ session: null, needsEmailConfirmation: true }),
      });
      const store = createSessionStore({
        auth,
        loadIdentity: async () => identity,
      });

      expect(await store.signUp({ email: 'a@b.test', password: 'pw' })).toBe(
        false,
      );
      expect(store.state.status).toBe('restoring');
      expect(store.state.identity).toBeNull();
    });

    it('reports a duplicate address as such', async () => {
      const { auth } = stubProvider({
        signUp: async () => {
          throw new AuthError('email_taken', 'already registered');
        },
      });
      const store = createSessionStore({
        auth,
        loadIdentity: async () => identity,
      });

      await store.signUp({ email: 'a@b.test', password: 'pw' });
      expect(store.state.authError).toBe('email_taken');
    });
  });

  describe('sign out and external changes', () => {
    it('clears everything and tells the provider', async () => {
      const { auth } = stubProvider({ restoreSession: async () => session });
      const signOut = vi.spyOn(auth, 'signOut');
      const store = createSessionStore({
        auth,
        loadIdentity: async () => identity,
      });

      await store.bootstrap();
      await store.signOut();

      expect(signOut).toHaveBeenCalledTimes(1);
      expect(store.state.status).toBe('anonymous');
      expect(store.state.session).toBeNull();
      expect(store.state.identity).toBeNull();
    });

    it('follows a sign-out that happened elsewhere', async () => {
      const { auth, emit } = stubProvider({ restoreSession: async () => session });
      const store = createSessionStore({
        auth,
        loadIdentity: async () => identity,
      });

      await store.bootstrap();
      emit(null);

      expect(store.state.status).toBe('anonymous');
      expect(store.state.identity).toBeNull();
    });

    it('does not re-fetch the identity when the token merely refreshes', async () => {
      // The provider refreshes on a timer. Reloading identity each time would
      // turn a silent background refresh into a request storm.
      const { auth, emit } = stubProvider({ restoreSession: async () => session });
      const loadIdentity = vi.fn(async () => identity);
      const store = createSessionStore({ auth, loadIdentity });

      await store.bootstrap();
      expect(loadIdentity).toHaveBeenCalledTimes(1);

      emit({ ...session, accessToken: 'refreshed' });

      expect(loadIdentity).toHaveBeenCalledTimes(1);
      expect(store.state.session?.accessToken).toBe('refreshed');
      expect(store.state.status).toBe('authenticated');
    });

    it('ignores the provider’s initial null while still restoring', async () => {
      // supabase-js emits an INITIAL_SESSION event at subscribe time. Acting on
      // it would settle the store as anonymous before bootstrap has looked.
      const { auth, emit } = stubProvider({ restoreSession: async () => session });
      const store = createSessionStore({
        auth,
        loadIdentity: async () => identity,
      });

      emit(null);
      expect(store.state.status).toBe('restoring');

      await store.bootstrap();
      expect(store.state.status).toBe('authenticated');
    });

    it('stops listening when disposed', async () => {
      const { auth, unsubscribe } = stubProvider();
      const store = createSessionStore({
        auth,
        loadIdentity: async () => identity,
      });

      store.dispose();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });
});
