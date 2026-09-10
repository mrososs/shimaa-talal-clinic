export const ClinicalErrorCode = {
  EncounterFinalized: 'clinical_encounter_finalized',
  EncounterNotFound: 'clinical_encounter_not_found',
  InvalidMeasurement: 'clinical_invalid_measurement',
} as const;

export type ClinicalErrorCode =
  (typeof ClinicalErrorCode)[keyof typeof ClinicalErrorCode];

export class ClinicalError extends Error {
  constructor(
    readonly code: ClinicalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ClinicalError';
  }
}
