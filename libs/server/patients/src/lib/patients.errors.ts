/**
 * Rule violations this domain reports to its caller.
 *
 * Not HTTP exceptions: the domain does not know it is behind HTTP, and these
 * are equally meaningful to a workflow or a test. The API layer maps `code` to
 * a status and to the `ApiResponse` failure envelope.
 *
 * Only *expected* outcomes appear here. A database being unreachable is not a
 * domain error and should propagate as itself.
 */
export const PatientsErrorCode = {
  /** A guardian with this phone already exists in this clinic. */
  GuardianPhoneTaken: 'guardian_phone_taken',
  GuardianNotFound: 'guardian_not_found',
  /** The phone could not be read as a number in the clinic's region. */
  InvalidPhone: 'invalid_phone',
  /** A phone-auth account attempted to act on a different number. */
  VerifiedPhoneMismatch: 'verified_phone_mismatch',

  ChildNotFound: 'child_not_found',
  /** Another guardian is already the primary caregiver for this child. */
  PrimaryGuardianTaken: 'primary_guardian_taken',

  PatientFileNotFound: 'patient_file_not_found',
  InvalidPatientFile: 'invalid_patient_file',
  PatientFileStorageFailed: 'patient_file_storage_failed',

  /** The guardian is already linked to an account. */
  GuardianAlreadyClaimed: 'guardian_already_claimed',
  /** This auth user is already linked to a different guardian here. */
  AuthUserAlreadyLinked: 'auth_user_already_linked',

  /** No live code, or the code did not match. Deliberately one code for both. */
  ClaimCodeInvalid: 'claim_code_invalid',
  ClaimCodeExpired: 'claim_code_expired',
  /** Too many wrong attempts against the current code. */
  ClaimCodeLocked: 'claim_code_locked',
} as const;

export type PatientsErrorCode =
  (typeof PatientsErrorCode)[keyof typeof PatientsErrorCode];

export class PatientsError extends Error {
  constructor(
    readonly code: PatientsErrorCode,
    message: string,
    cause?: unknown,
    /**
     * Extra the client can act on — never anything about the failure itself.
     *
     * `cause` holds the driver error and stays server-side; this is a
     * deliberately constructed payload, so nothing can carry a constraint name
     * or a query into a response by accident.
     */
    readonly details?: unknown,
  ) {
    super(message, { cause });
    this.name = 'PatientsError';
  }
}

/** Postgres unique-violation. The only driver code this domain interprets. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; constraint?: unknown };
  if (candidate.code !== UNIQUE_VIOLATION) {
    return false;
  }
  return constraint === undefined || candidate.constraint === constraint;
}
