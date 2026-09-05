import type { ClinicMemberRole, ClinicMemberStatus } from '@clinic/contracts';

/**
 * The seam between an authenticated user and their staff membership.
 *
 * Declared here, implemented in `libs/server/clinic`, bound in `apps/api`.
 */

/**
 * The minimum needed to authorise a staff request: who they are, which tenant
 * they belong to, what they may do, and whether they may still act at all.
 *
 * `clinicId` is the tenant boundary. It is resolved from the token and never
 * read from a request body — that is what stops one clinic reaching another's
 * rows by passing an id.
 */
export interface ClinicMemberContext {
  id: string;
  clinicId: string;
  role: ClinicMemberRole;
  status: ClinicMemberStatus;
}

export interface ClinicMemberResolver {
  /** `null` when the user is not staff at any clinic. */
  resolveByAuthUserId(authUserId: string): Promise<ClinicMemberContext | null>;
}

export const CLINIC_MEMBER_RESOLVER = Symbol('CLINIC_MEMBER_RESOLVER');
