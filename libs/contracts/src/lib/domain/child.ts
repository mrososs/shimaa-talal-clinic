import type { GuardianRelationship } from './guardian-relationship';
import type { IsoDate } from './temporal';

export const ChildSex = {
  Male: 'male',
  Female: 'female',
} as const;

export type ChildSex = (typeof ChildSex)[keyof typeof ChildSex];

/**
 * The patient.
 *
 * Operational identity only. Diagnoses, prescriptions, allergies, vaccination
 * history and growth measurements are a medical record, which this platform
 * does not have and this phase does not build.
 */
export interface Child {
  id: string;
  clinicId: string;
  fullName: string;

  /** Often unknown when reception books over the phone, so it is optional. */
  dateOfBirth: IsoDate | null;
  sex: ChildSex | null;
}

/** A child together with how the guardian in context relates to them. */
export interface GuardianChild extends Child {
  relationship: GuardianRelationship;
  /** Exactly one guardian per child is primary. */
  isPrimary: boolean;
}

/** Enough to identify a child in a list or on a queue card. */
export interface ChildSummary {
  id: string;
  fullName: string;
  dateOfBirth: IsoDate | null;
}
