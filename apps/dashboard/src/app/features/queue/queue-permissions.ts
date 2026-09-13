import { ClinicMemberRole } from '@clinic/contracts';

/**
 * Who may do what on the queue board.
 *
 * Reception runs the desk: admitting, ordering, removing, skipping. Vitals are
 * a clinical reading that lands in the child's record, so capturing them stays
 * with the doctor. The two are easy to confuse because both happen at the same
 * moment in the room, so they answer here rather than in the template.
 */
export function canManageQueue(role: ClinicMemberRole | null): boolean {
  return role === ClinicMemberRole.Reception || role === ClinicMemberRole.Admin;
}

export function canRecordMeasurements(role: ClinicMemberRole | null): boolean {
  return role === ClinicMemberRole.Doctor || role === ClinicMemberRole.Admin;
}

/**
 * Who decides that the next patient is summoned.
 *
 * The desk owns the order of the room, so calling the next patient — alone or
 * folded into "finish and call next" — is reception's. The doctor still ends
 * her own consultation; she simply does not decide who walks in after it.
 */
export function canCallNext(role: ClinicMemberRole | null): boolean {
  return role === ClinicMemberRole.Reception || role === ClinicMemberRole.Admin;
}
