/**
 * Why the patient is coming.
 *
 * Operational only: it drives wording and filtering, never scheduling. Every
 * visit type occupies one seat in one arrival window — durations and fees per
 * type are a Payments and scheduling concern that this phase does not have.
 */
export const VisitType = {
  NewVisit: 'new_visit',
  FollowUp: 'follow_up',
  Vaccination: 'vaccination',
  Consultation: 'consultation',
  Newborn: 'newborn',
} as const;

export type VisitType = (typeof VisitType)[keyof typeof VisitType];
