import { createHash, randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import type { Guardian, IsoInstant } from '@clinic/contracts';
import type { PhoneRegion } from '@clinic/phone';
import { GuardianService } from './guardian.service';
import { PatientsError, PatientsErrorCode } from './patients.errors';

/** Long enough to type from a screen, short enough to read aloud on a call. */
const CODE_LENGTH = 6;

/** The code is meant to be used in the next minute or two, not tomorrow. */
export const CLAIM_CODE_TTL_MINUTES = 15;

/** Wrong guesses before the code stops working. 10^6 space, so this is ample. */
export const CLAIM_CODE_MAX_ATTEMPTS = 5;

export interface IssuedClaimCode {
  /** Returned once, to the staff member. Never stored, never retrievable. */
  code: string;
  expiresAt: IsoInstant;
}

export interface ClaimInput {
  clinicId: string;
  guardianId: string;
  code: string;
  /** The signed-in user who will own the guardian record. */
  authUserId: string;
}

/**
 * Linking an app account to a family the clinic already knows.
 *
 * Phone ownership is not verified anywhere in this MVP — there is no OTP — so
 * a matching phone number must never, by itself, grant access to a family's
 * records. Reception issues a short-lived code instead, in person or on the
 * call, and the parent types it in. That is the whole mechanism: no SMS
 * provider, no email verification, no social login.
 *
 * The plaintext exists for exactly one moment, in the response to the staff
 * member who issued it. Only a SHA-256 digest is stored, so a database leak
 * yields no usable codes.
 */
@Injectable()
export class ClaimCodeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly guardians: GuardianService,
  ) {}

  /**
   * Issue a code for a guardian who has no account yet.
   *
   * Any previous unconsumed code for that guardian is dropped first — the
   * partial unique index permits only one live code per guardian, which is also
   * what stops a stack of old codes staying valid.
   */
  async issue(
    clinicId: string,
    guardianId: string,
    issuedByMemberId: string,
    db?: SqlExecutor,
  ): Promise<IssuedClaimCode> {
    const run = async (tx: SqlExecutor): Promise<IssuedClaimCode> => {
      const guardian = await this.guardians.findById(clinicId, guardianId, tx);
      if (guardian === null) {
        throw new PatientsError(
          PatientsErrorCode.GuardianNotFound,
          'No such guardian at this clinic.',
        );
      }
      if (guardian.hasAccount) {
        throw new PatientsError(
          PatientsErrorCode.GuardianAlreadyClaimed,
          'That guardian is already linked to an account.',
        );
      }

      await tx.query(
        `delete from clinic.guardian_claim_codes
          where guardian_id = $1 and consumed_at is null`,
        [guardianId],
      );

      const code = generateCode();
      const result = await tx.query<{ expires_at: Date }>(
        `insert into clinic.guardian_claim_codes
           (guardian_id, code_hash, expires_at, issued_by_member_id)
         values ($1, $2, now() + ($3 || ' minutes')::interval, $4)
         returning expires_at`,
        [
          guardianId,
          fingerprint(code),
          String(CLAIM_CODE_TTL_MINUTES),
          issuedByMemberId,
        ],
      );

      return {
        code,
        expiresAt: new Date(result.rows[0].expires_at).toISOString(),
      };
    };

    return db ? run(db) : this.database.transaction(run);
  }

  /**
   * Consume a code and link the guardian to the calling account.
   *
   * Every decision that matters is a condition inside a statement rather than a
   * check performed beforehand:
   *
   *   - the attempt counter is incremented by the same UPDATE that reads the
   *     code, so a wrong guess is recorded even though the attempt fails;
   *   - the code is consumed by an UPDATE requiring `consumed_at is null`;
   *   - the guardian is linked by an UPDATE requiring `auth_user_id is null`.
   *
   * Two people racing to claim the same guardian therefore resolve to exactly
   * one winner, and the loser gets a conflict rather than a second link.
   */
  async claim(input: ClaimInput, db?: SqlExecutor): Promise<Guardian> {
    // Recorded outside the transaction below, so a wrong guess still counts
    // even though the operation that follows it fails and rolls back.
    const attempt = await (db ?? this.database).query<{
      id: string;
      code_hash: string;
      attempts: number;
      expired: boolean;
    }>(
      `update clinic.guardian_claim_codes
          set attempts = attempts + 1
        where guardian_id = $1 and consumed_at is null
        returning id, code_hash, attempts, (expires_at <= now()) as expired`,
      [input.guardianId],
    );

    const row = attempt.rows[0];
    if (row === undefined) {
      throw new PatientsError(
        PatientsErrorCode.ClaimCodeInvalid,
        'That code is not valid.',
      );
    }
    if (row.attempts > CLAIM_CODE_MAX_ATTEMPTS) {
      throw new PatientsError(
        PatientsErrorCode.ClaimCodeLocked,
        'Too many attempts. Ask the clinic for a new code.',
      );
    }
    if (row.expired) {
      throw new PatientsError(
        PatientsErrorCode.ClaimCodeExpired,
        'That code has expired. Ask the clinic for a new one.',
      );
    }
    if (!matches(row.code_hash, input.code)) {
      throw new PatientsError(
        PatientsErrorCode.ClaimCodeInvalid,
        'That code is not valid.',
      );
    }

    const run = async (tx: SqlExecutor): Promise<Guardian> => {
      const consumed = await tx.query(
        `update clinic.guardian_claim_codes
            set consumed_at = now(), consumed_by_auth_user_id = $2
          where id = $1 and consumed_at is null`,
        [row.id, input.authUserId],
      );

      // Someone else consumed it between the read above and here.
      if (consumed.rowCount === 0) {
        throw new PatientsError(
          PatientsErrorCode.ClaimCodeInvalid,
          'That code is not valid.',
        );
      }

      // Throws GuardianAlreadyClaimed if the guardian was linked meanwhile,
      // which rolls the consumption back with it.
      return this.guardians.linkAuthUser(
        input.clinicId,
        input.guardianId,
        input.authUserId,
        'claim_code',
        tx,
      );
    };

    return db ? run(db) : this.database.transaction(run);
  }

  /**
   * Whether a phone belongs to a family this clinic already knows.
   *
   * Answers with a boolean and nothing else. Returning a name, or a child
   * count, would turn an unauthenticated guess at a phone number into a way to
   * read a family's details. A phone that is already claimed by somebody else
   * reports `false` too, so a match and a non-match are indistinguishable
   * except in the one case where the answer is actually useful.
   */
  async hasUnclaimedGuardianForPhone(
    clinicId: string,
    phone: string,
    region: PhoneRegion,
    db: SqlExecutor = this.database,
  ): Promise<boolean> {
    const guardian = await this.guardians.findByPhone(
      clinicId,
      phone,
      region,
      db,
    );
    return guardian !== null && !guardian.hasAccount;
  }
}

/**
 * Uniform over the full range, from a CSPRNG.
 *
 * `Math.random()` would be predictable enough to guess, and a code that can be
 * guessed is a way into somebody's medical records.
 */
function generateCode(): string {
  const max = 10 ** CODE_LENGTH;
  return String(randomInt(0, max)).padStart(CODE_LENGTH, '0');
}

function fingerprint(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Compared over the digests, which are fixed-length, so the comparison leaks
 * nothing about the code through its duration.
 */
function matches(storedHash: string, candidate: string): boolean {
  return storedHash === fingerprint(candidate);
}
