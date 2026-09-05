import type { ClinicMemberRole } from './clinic-member-role';

/** Whether a staff account may still act. `Suspended` fails the API's guard. */
export const ClinicMemberStatus = {
  Active: 'active',
  Suspended: 'suspended',
} as const;

export type ClinicMemberStatus =
  (typeof ClinicMemberStatus)[keyof typeof ClinicMemberStatus];

/**
 * A member of clinic staff.
 *
 * The link to Supabase Auth is deliberately absent: a client has no use for an
 * auth user id, and not sending it is one fewer identifier to leak.
 */
export interface ClinicMember {
  id: string;
  clinicId: string;
  role: ClinicMemberRole;
  displayName: string;
  status: ClinicMemberStatus;
}
