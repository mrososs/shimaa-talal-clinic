import { createApiClient, type ApiClient } from '@clinic/api-client';
import {
  createSupabaseAuthProvider,
  type AuthProvider,
} from '@clinic/client-auth';
import { getClientConfig, isSupabaseConfigured } from '@clinic/client-config';
import { createSessionStore, type SessionStore } from '@clinic/client-session';
import type { ClinicMeResponse } from '@clinic/contracts';
import { createClinicApi, type ClinicApi } from './features/clinic/clinic.api';
import { createQueueApi, type QueueApi } from './features/queue/queue.api';

/**
 * Composition root for everything this app talks to.
 *
 * The app's outward dependencies are declared here and only here: screens
 * import `session` and `clinicApi`, never `createClient` or `fetch`.
 */

export const config = getClientConfig();

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

export const clinicApi: ClinicApi = createClinicApi(apiClient);
export const queueApi: QueueApi = createQueueApi(apiClient);

/**
 * The staff session: the account, and the membership that makes it staff.
 *
 * `identityError: 'forbidden'` is the important state here — a parent account
 * signing into the dashboard. They are genuinely signed in and simply have no
 * clinic membership, so the shell says so rather than bouncing them back to a
 * login screen that would let them straight back in.
 */
export const session: SessionStore<ClinicMeResponse> =
  createSessionStore<ClinicMeResponse>({
    auth: auth ?? unconfiguredAuth(),
    loadIdentity: () => clinicApi.me(),
  });

/** Fails honestly rather than leaving a login screen that silently does nothing. */
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
