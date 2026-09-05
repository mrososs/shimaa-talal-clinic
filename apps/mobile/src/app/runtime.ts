import { createApiClient, type ApiClient } from '@clinic/api-client';
import {
  createSupabaseAuthProvider,
  type AuthProvider,
} from '@clinic/client-auth';
import { getClientConfig, isSupabaseConfigured } from '@clinic/client-config';
import { createSessionStore, type SessionStore } from '@clinic/client-session';
import type { MeResponse } from '@clinic/contracts';
import {
  createBookingApi,
  type BookingApi,
} from './features/booking/booking.api';
import {
  createIdentityApi,
  type IdentityApi,
} from './features/identity/identity.api';
import { createQueueApi, type QueueApi } from './features/queue/queue.api';

/**
 * Composition root for everything this app talks to.
 *
 * The app's outward dependencies are declared here and only here: screens
 * import `session` and `identityApi`, never `createClient` or `fetch`. That is
 * what keeps the Supabase key, the API base URL and the token plumbing in one
 * auditable file.
 */

export const config = getClientConfig();

/**
 * `null` when Supabase is unconfigured, which is a real local state — the app
 * still builds and boots so a developer can see the shell without credentials.
 * Every consumer below treats it as fatal for anything requiring a session.
 */
export const auth: AuthProvider | null = isSupabaseConfigured(config)
  ? createSupabaseAuthProvider({
      supabaseUrl: config.supabaseUrl,
      publishableKey: config.supabasePublishableKey,
    })
  : null;

export const apiClient: ApiClient = createApiClient({
  baseUrl: config.apiUrl,
  getAccessToken: () => auth?.getAccessToken() ?? null,
});

export const identityApi: IdentityApi = createIdentityApi(apiClient);
export const bookingApi: BookingApi = createBookingApi(apiClient);
export const queueApi: QueueApi = createQueueApi(apiClient);

/**
 * The signed-in session, and who that account is at the clinic.
 *
 * `guardian: null` inside the identity is the onboarding state, not a failure —
 * see the router's guard, which is the only place that decision is made.
 */
export const session: SessionStore<MeResponse> = createSessionStore<MeResponse>(
  {
    auth: auth ?? unconfiguredAuth(),
    loadIdentity: () => identityApi.me(),
  },
);

/**
 * A provider that fails honestly rather than one that pretends.
 *
 * Returning a no-op provider would leave the app sitting on a login screen that
 * silently does nothing. This way the failure names itself the moment anyone
 * tries to sign in.
 */
function unconfiguredAuth(): AuthProvider {
  const fail = (): never => {
    throw new Error(
      'Supabase is not configured: set VITE_SUPABASE_URL and ' +
        'VITE_SUPABASE_PUBLISHABLE_KEY.',
    );
  };
  return {
    getSession: async () => null,
    getAccessToken: async () => null,
    restoreSession: async () => null,
    signInWithPassword: fail,
    signUp: fail,
    onAuthStateChange: () => () => undefined,
    signOut: async () => undefined,
  };
}
