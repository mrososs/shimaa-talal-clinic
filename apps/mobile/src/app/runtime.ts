import { createApiClient, type ApiClient } from '@clinic/api-client';
import {
  createSupabaseAuthProvider,
  type AuthProvider,
} from '@clinic/client-auth';
import { getClientConfig, isSupabaseConfigured } from '@clinic/client-config';

/**
 * Composition root for everything this app talks to.
 *
 * Nothing renders from here yet — no screen imports it, so it is not part of
 * the bundle. It exists so that the app's outward dependencies are declared in
 * exactly one file, and so Phase 2 features have a single obvious place to get
 * an `ApiClient` from.
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
