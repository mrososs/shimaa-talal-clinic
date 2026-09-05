import type { IsoInstant } from './temporal';

/**
 * A parent or caregiver, as the clinic knows them.
 *
 * Not the same thing as an authenticated user. Reception creates guardians for
 * families who have never installed the app, and those families must be able to
 * book, arrive and be served. The link to Supabase Auth is optional and lives
 * server-side; clients get `hasAccount` instead, which is the only part of it
 * they need — it decides whether to offer a claim code.
 */
export interface Guardian {
  id: string;
  clinicId: string;
  fullName: string;

  /** E.164. The clinic's lookup key. See `@clinic/phone`. */
  phoneE164: string;
  email: string | null;

  /** True once this guardian has been linked to a signed-in account. */
  hasAccount: boolean;

  createdAt: IsoInstant;
}

/** Enough to identify a guardian in a list or on a queue card. */
export interface GuardianSummary {
  id: string;
  fullName: string;
  phoneE164: string;
}
