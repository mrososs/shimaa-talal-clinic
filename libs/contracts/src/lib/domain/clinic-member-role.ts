import { UserRole } from './user-role';

/**
 * What a member of clinic staff may do.
 *
 * Derived from `UserRole` rather than redeclared, so the two can never drift on
 * the strings the database stores. It is the staff subset: a guardian is never
 * a clinic member, which is why `UserRole.Guardian` is absent.
 *
 * The label shown to staff for `Reception` is "مساعدة العيادة" — the code value
 * stays `reception`.
 */
export const ClinicMemberRole = {
  Doctor: UserRole.Doctor,
  Reception: UserRole.Reception,
  Admin: UserRole.Admin,
} as const;

export type ClinicMemberRole =
  (typeof ClinicMemberRole)[keyof typeof ClinicMemberRole];
