import type { IsoInstant } from '../domain/temporal';

export const ClinicalEncounterStatus = {
  Draft: 'draft',
  Final: 'final',
} as const;

export type ClinicalEncounterStatus =
  (typeof ClinicalEncounterStatus)[keyof typeof ClinicalEncounterStatus];

export interface ClinicalEncounter {
  id: string;
  appointmentId: string;
  childId: string;
  status: ClinicalEncounterStatus;
  diagnosis: string;
  investigations: string;
  treatmentInstructions: string;
  growthObservation: string;
  followUpDays: number | null;
  parentSummary: string;
  revision: number;
  updatedAt: IsoInstant;
  finalizedAt: IsoInstant | null;
}

export interface ClinicalMeasurement {
  id: string;
  childId: string;
  appointmentId: string | null;
  weightKg: number | null;
  heightCm: number | null;
  headCircumferenceCm: number | null;
  temperatureC: number | null;
  measuredAt: IsoInstant;
}

/** A guardian-safe growth point. Clinical context and temperature stay staff-only. */
export interface ParentGrowthMeasurement {
  id: string;
  weightKg: number | null;
  heightCm: number | null;
  headCircumferenceCm: number | null;
  measuredAt: IsoInstant;
}

export interface ParentGrowthView {
  child: {
    id: string;
    fullName: string;
    dateOfBirth: string | null;
    sex: 'male' | 'female' | null;
  };
  measurements: ParentGrowthMeasurement[];
}

export interface ClinicalRecord {
  encounter: ClinicalEncounter | null;
  measurements: ClinicalMeasurement[];
  previousEncounters: Array<
    Pick<
      ClinicalEncounter,
      'id' | 'appointmentId' | 'diagnosis' | 'finalizedAt'
    >
  >;
}

export interface SaveClinicalEncounterInput {
  diagnosis: string;
  investigations: string;
  treatmentInstructions: string;
  growthObservation: string;
  followUpDays: number | null;
  parentSummary: string;
}

export interface CreateClinicalMeasurementInput {
  appointmentId?: string | null;
  weightKg?: number | null;
  heightCm?: number | null;
  headCircumferenceCm?: number | null;
  temperatureC?: number | null;
}
