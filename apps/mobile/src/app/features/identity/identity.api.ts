import type { ApiClient } from '@clinic/api-client';
import type {
  ClaimRequestResponse,
  Guardian,
  GuardianChild,
  GuardianRelationship,
  MeResponse,
} from '@clinic/contracts';

/**
 * The parent identity endpoints, typed.
 *
 * Thin on purpose: one function per route, no caching, no state. The paths live
 * here and nowhere else, so a screen never spells one out and the API client
 * stays generic.
 */

export interface CreateGuardianInput {
  fullName: string;
  /** As typed. The server normalises it against the clinic's region. */
  phone: string;
  email?: string;
  relationship?: GuardianRelationship;
}

export interface CreateChildInput {
  fullName: string;
  dateOfBirth?: string;
  sex?: 'male' | 'female';
  relationship?: GuardianRelationship;
}

export function createIdentityApi(client: ApiClient) {
  return {
    me: (): Promise<MeResponse> => client.get<MeResponse>('me'),

    createGuardian: (input: CreateGuardianInput): Promise<Guardian> =>
      client.post<Guardian>('me/guardian', input),

    listChildren: (): Promise<GuardianChild[]> =>
      client.get<GuardianChild[]>('me/children'),

    createChild: (input: CreateChildInput): Promise<GuardianChild> =>
      client.post<GuardianChild>('me/children', input),

    /**
     * "Do you already know this number?"
     *
     * Answers with a boolean and nothing else — no name, no child count. A
     * match and a non-match are indistinguishable apart from this flag, which
     * is what stops a guess at a phone number becoming a way to read a family.
     */
    claimRequest: (phone: string): Promise<ClaimRequestResponse> =>
      client.post<ClaimRequestResponse>('me/guardian/claim-request', { phone }),

    /**
     * Link this account to a family the clinic already knows.
     *
     * The matching phone number grants nothing on its own — phone ownership is
     * unverified here. The code, issued by reception, is what authorises it.
     */
    claim: (phone: string, code: string): Promise<Guardian> =>
      client.post<Guardian>('me/guardian/claim', { phone, code }),
  };
}

export type IdentityApi = ReturnType<typeof createIdentityApi>;
