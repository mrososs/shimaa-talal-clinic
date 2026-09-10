/**
 * "May this guardian act for this child?"
 *
 * Declared here, implemented in `libs/server/patients`, bound in `apps/api` —
 * the same inversion `GUARDIAN_RESOLVER` and `TOKEN_VERIFIER` use.
 *
 * Booking needs the answer before it will hold a seat for a child, and Queue
 * will need it too. Neither may depend on Patients: domains are islands. But
 * the fact lives in `guardian_children`, which Patients owns, and duplicating
 * the query into every domain that asks is how two versions of "owns" end up
 * disagreeing.
 *
 * A port rather than a workflow because this is a *question*, not a
 * transaction. Workflows exist for writes that must commit together; a booking
 * asking whether a child is this family's is one domain reading another's
 * answer, and it changes nothing.
 */
export interface ChildAccessChecker {
  /** Whether the child belongs to the clinic, without exposing other tenants. */
  childExistsInClinic(clinicId: string, childId: string): Promise<boolean>;

  /**
   * Whether the guardian may act for the child, within one clinic.
   *
   * Clinic-scoped on purpose: a child id from another tenant must answer
   * `false` rather than leaking that it exists somewhere.
   */
  canGuardianAccessChild(
    clinicId: string,
    guardianId: string,
    childId: string,
  ): Promise<boolean>;
}

export const CHILD_ACCESS_CHECKER = Symbol('CHILD_ACCESS_CHECKER');
