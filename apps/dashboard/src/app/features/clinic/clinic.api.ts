import type { ApiClient } from '@clinic/api-client';
import type { ClinicMeResponse } from '@clinic/contracts';

/**
 * The staff endpoints, typed.
 *
 * One function per route. The paths live here and nowhere else, so a screen
 * never spells one out and the API client stays generic.
 */
export function createClinicApi(client: ApiClient) {
  return {
    me: (): Promise<ClinicMeResponse> => client.get<ClinicMeResponse>('clinic/me'),
  };
}

export type ClinicApi = ReturnType<typeof createClinicApi>;
