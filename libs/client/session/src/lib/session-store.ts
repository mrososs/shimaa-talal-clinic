import { reactive, readonly, type DeepReadonly } from 'vue';
import { ApiClientError } from '@clinic/api-client';
import {
  AuthError,
  type AuthCredentials,
  type AuthErrorCode,
  type AuthProvider,
  type AuthSession,
  type PhoneOtpCredentials,
} from '@clinic/client-auth';

/**
 * The session, shared by both apps.
 *
 * Two facts have to be tracked together and are constantly confused: a Supabase
 * account, and who that account is at the clinic. They are separate. A parent
 * can be signed in with no guardian yet — that is onboarding, not an error —
 * and a staff account signing into the mobile app is signed in with no clinic
 * membership. Every screen decision downstream comes from the pair.
 *
 * Which identity to load is injected, so the same store serves `/me` on mobile
 * and `/clinic/me` on the dashboard without knowing either exists.
 *
 * Built on Vue's own reactivity rather than a store library. The state here is
 * one object with five fields and no cross-store composition, which is less
 * than a dependency is worth — and the plan listed Pinia as a decision still
 * open. If several stores start needing to observe each other, that is the
 * moment to revisit it, not now.
 */

export type SessionStatus =
  /** Before the first `bootstrap()` settles. Render a splash, not a login. */
  'restoring' | 'anonymous' | 'authenticated';

/**
 * Why loading the clinic identity failed, when it is not a transport problem.
 *
 * `forbidden` is a real, expected state rather than a fault: it is a parent
 * signing into the dashboard, or a suspended member. The shell renders it as a
 * sentence, and offers a way back out.
 */
export type IdentityErrorCode = 'forbidden' | 'unavailable';

export interface SessionState<TIdentity> {
  status: SessionStatus;
  session: AuthSession | null;
  identity: TIdentity | null;
  /** True while a sign-in, sign-up or sign-out is in flight. */
  pending: boolean;
  /** The last credential failure, cleared when the next attempt starts. */
  authError: AuthErrorCode | null;
  identityError: IdentityErrorCode | null;
}

export interface SessionStoreOptions<TIdentity> {
  auth: AuthProvider;
  /** Fetches who this account is at the clinic. Throws `ApiClientError`. */
  loadIdentity: () => Promise<TIdentity>;
}

export interface SessionStore<TIdentity> {
  readonly state: DeepReadonly<SessionState<TIdentity>>;
  /** Resolve a persisted session at app start. Safe to await before routing. */
  bootstrap(): Promise<void>;
  signIn(credentials: AuthCredentials): Promise<boolean>;
  /**
   * Returns whether the account is usable now. `false` means the project
   * requires email confirmation, so there is no session to route with.
   */
  signUp(credentials: AuthCredentials): Promise<boolean>;
  /** Send an SMS challenge. No authenticated state exists until verification. */
  startPhoneOtp(phone: string): Promise<boolean>;
  /** Verify an SMS challenge, adopt its session and load the clinic identity. */
  verifyPhoneOtp(credentials: PhoneOtpCredentials): Promise<boolean>;
  requestPasswordReset(email: string, redirectTo: string): Promise<boolean>;
  updatePassword(password: string): Promise<boolean>;
  signOut(): Promise<void>;
  /**
   * Forget the last credential failure.
   *
   * The store outlives any one screen, so an error raised on sign-in is still
   * there when the register screen mounts — and a person who has typed nothing
   * yet is told their password is wrong. Each auth screen clears it on entry.
   */
  clearAuthError(): void;
  /**
   * End a session the API has stopped accepting.
   *
   * Called when a request comes back 401 — which can be several requests at
   * once, since a screen may have a poll and a command in flight together — so
   * it is idempotent: the first caller clears the session, the rest are a
   * no-op. Without that, each failing request would start its own sign-out.
   *
   * Distinct from `signOut`, which is a person choosing to leave and may
   * legitimately run from an already-anonymous state.
   */
  terminate(): Promise<void>;
  /** Re-read the identity — after onboarding, or after claiming a family. */
  refreshIdentity(): Promise<void>;
  /** Stop listening to the auth provider. */
  dispose(): void;
}

export function createSessionStore<TIdentity>(
  options: SessionStoreOptions<TIdentity>,
): SessionStore<TIdentity> {
  const state = reactive<SessionState<TIdentity>>({
    status: 'restoring',
    session: null,
    identity: null,
    pending: false,
    authError: null,
    identityError: null,
  }) as SessionState<TIdentity>;

  /**
   * Load the clinic identity for the session we hold.
   *
   * A 401 means the token is no longer good, so the session goes with it. A 403
   * does not: the account is genuinely signed in and simply has no business
   * here. Signing someone out on a 403 would drop them back at a login screen
   * that will let them straight back in, forever.
   */
  async function loadIdentity(): Promise<void> {
    try {
      state.identity = await options.loadIdentity();
      state.identityError = null;
    } catch (error) {
      state.identity = null;

      if (error instanceof ApiClientError && error.status === 401) {
        await clearSession();
        return;
      }
      state.identityError =
        error instanceof ApiClientError && error.status === 403
          ? 'forbidden'
          : 'unavailable';
    }
  }

  async function clearSession(): Promise<void> {
    state.session = null;
    state.identity = null;
    state.identityError = null;
    state.status = 'anonymous';
    await options.auth.signOut();
  }

  /**
   * Guards the one-shot property of `terminate`.
   *
   * The state alone cannot do it: several 401s land in the same tick, before
   * the first `await` inside `clearSession` has set the status, so all of them
   * would see `authenticated` and each start a sign-out.
   */
  let terminating: Promise<void> | null = null;

  async function adopt(session: AuthSession): Promise<void> {
    state.session = session;
    state.status = 'authenticated';
    await loadIdentity();
  }

  /**
   * React to the provider changing the session underneath us — a refreshed
   * token, or a sign-out from another tab.
   *
   * Only the transition to *no session* is acted on. A refreshed token arrives
   * here on a timer, and re-fetching the identity every time it does would turn
   * a silent background refresh into a request storm.
   */
  const unsubscribe = options.auth.onAuthStateChange((session) => {
    if (session === null) {
      if (state.status === 'restoring') return;
      state.session = null;
      state.identity = null;
      state.identityError = null;
      state.status = 'anonymous';
      return;
    }
    state.session = session;
  });

  return {
    state: readonly(state) as DeepReadonly<SessionState<TIdentity>>,

    async bootstrap() {
      try {
        const session = await options.auth.restoreSession();
        if (session === null) {
          state.status = 'anonymous';
          return;
        }
        await adopt(session);
      } catch {
        // Restoring is best-effort. A failure here means "we could not prove a
        // session", which is the anonymous state — not something to show a
        // parent an error screen about before they have done anything.
        state.status = 'anonymous';
      }
    },

    async signIn(credentials) {
      state.pending = true;
      state.authError = null;
      try {
        await adopt(await options.auth.signInWithPassword(credentials));
        return true;
      } catch (error) {
        state.authError = error instanceof AuthError ? error.code : 'unknown';
        return false;
      } finally {
        state.pending = false;
      }
    },

    async signUp(credentials) {
      state.pending = true;
      state.authError = null;
      try {
        const result = await options.auth.signUp(credentials);
        if (result.session === null) {
          // The account may exist, but it cannot act. Routing to a signed-in
          // screen here would show an empty app that 401s on every request.
          return false;
        }
        await adopt(result.session);
        return true;
      } catch (error) {
        state.authError = error instanceof AuthError ? error.code : 'unknown';
        return false;
      } finally {
        state.pending = false;
      }
    },

    async startPhoneOtp(phone) {
      state.pending = true;
      state.authError = null;
      try {
        await options.auth.startPhoneOtp(phone);
        return true;
      } catch (error) {
        state.authError = error instanceof AuthError ? error.code : 'unknown';
        return false;
      } finally {
        state.pending = false;
      }
    },

    async verifyPhoneOtp(credentials) {
      state.pending = true;
      state.authError = null;
      try {
        await adopt(await options.auth.verifyPhoneOtp(credentials));
        return true;
      } catch (error) {
        state.authError = error instanceof AuthError ? error.code : 'unknown';
        return false;
      } finally {
        state.pending = false;
      }
    },

    async requestPasswordReset(email, redirectTo) {
      state.pending = true;
      state.authError = null;
      try {
        await options.auth.requestPasswordReset(email, redirectTo);
        return true;
      } catch (error) {
        state.authError = error instanceof AuthError ? error.code : 'unknown';
        return false;
      } finally {
        state.pending = false;
      }
    },

    async updatePassword(password) {
      state.pending = true;
      state.authError = null;
      try {
        await options.auth.updatePassword(password);
        return true;
      } catch (error) {
        state.authError = error instanceof AuthError ? error.code : 'unknown';
        return false;
      } finally {
        state.pending = false;
      }
    },

    async signOut() {
      state.pending = true;
      try {
        await clearSession();
      } finally {
        state.pending = false;
      }
    },

    clearAuthError() {
      state.authError = null;
    },

    terminate() {
      if (state.status === 'anonymous') return Promise.resolve();
      terminating ??= clearSession().finally(() => {
        terminating = null;
      });
      return terminating;
    },

    async refreshIdentity() {
      if (state.status !== 'authenticated') return;
      await loadIdentity();
    },

    dispose() {
      unsubscribe();
    },
  };
}
