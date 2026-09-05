import { createHash, createHmac } from 'node:crypto';
import {
  CLAIM_CODE_MAX_ATTEMPTS,
  ClaimCodeService,
} from './claim-code.service';
import { GuardianService } from './guardian.service';
import { PatientsErrorCode } from './patients.errors';
import {
  REGION,
  describeWithDatabase,
  testConfig,
  uniquePhone,
} from './patients.fixture';

/**
 * The two properties a claim code depends on, each of which was asserted in a
 * commit message before it was measured.
 *
 * A rate limit that a caller can erase is not a rate limit, and a digest of six
 * digits is not a secret. Both are checked here against a real server rather
 * than reasoned about.
 */
describeWithDatabase('claim code hardening', (fx) => {
  const guardians = () => new GuardianService(fx.db.database);
  const claims = () =>
    new ClaimCodeService(
      fx.db.database,
      new GuardianService(fx.db.database),
      testConfig(),
    );

  async function attemptsFor(guardianId: string): Promise<number | null> {
    const row = await fx.db.database.query<{ attempts: number }>(
      `select attempts from clinic.guardian_claim_codes
        where guardian_id = $1 and consumed_at is null`,
      [guardianId],
    );
    return row.rows[0]?.attempts ?? null;
  }

  async function storedHashFor(guardianId: string): Promise<string> {
    const row = await fx.db.database.query<{ code_hash: string }>(
      `select code_hash from clinic.guardian_claim_codes where guardian_id = $1`,
      [guardianId],
    );
    return row.rows[0].code_hash;
  }

  async function setup(name = 'Hardening') {
    const guardian = await guardians().create({
      clinicId: fx.clinicId,
      region: REGION,
      fullName: name,
      phone: uniquePhone(),
    });
    const issued = await claims().issue(fx.clinicId, guardian.id, fx.memberId);
    const wrong = issued.code === '000000' ? '111111' : '000000';
    return { guardian, issued, wrong };
  }

  const guess = (guardianId: string, code: string, authUserId: string) =>
    claims()
      .claim({ clinicId: fx.clinicId, guardianId, code, authUserId })
      .then(
        () => 'claimed' as const,
        (error: { code?: string }) => error.code,
      );

  describe('failed attempts are counted durably', () => {
    it('records a wrong guess', async () => {
      const { guardian, wrong } = await setup();
      expect(await attemptsFor(guardian.id)).toBe(0);

      await guess(guardian.id, wrong, fx.authUserId);

      expect(await attemptsFor(guardian.id)).toBe(1);
    });

    it('accumulates across separate wrong guesses', async () => {
      const { guardian, wrong } = await setup();

      for (let i = 0; i < 3; i += 1) {
        await guess(guardian.id, wrong, fx.authUserId);
      }

      expect(await attemptsFor(guardian.id)).toBe(3);
    });

    it('counts the guess even when the caller owns a transaction that rolls back', async () => {
      // The counter is the one write here that must not ride on a caller's
      // transaction. If it did, guessing from inside one would be unlimited:
      // every wrong attempt would roll its own evidence away.
      const { guardian, wrong } = await setup();

      await fx.db.rollback(async (tx) => {
        await claims()
          .claim(
            {
              clinicId: fx.clinicId,
              guardianId: guardian.id,
              code: wrong,
              authUserId: fx.authUserId,
            },
            tx,
          )
          .catch(() => undefined);
      });

      expect(await attemptsFor(guardian.id)).toBe(1);
    });

    it('enforces the limit, and the limit outlives the failures that caused it', async () => {
      const { guardian, issued, wrong } = await setup();

      for (let i = 0; i < CLAIM_CODE_MAX_ATTEMPTS; i += 1) {
        expect(await guess(guardian.id, wrong, fx.authUserId)).toBe(
          PatientsErrorCode.ClaimCodeInvalid,
        );
      }

      expect(await attemptsFor(guardian.id)).toBe(CLAIM_CODE_MAX_ATTEMPTS);

      // The correct code no longer helps — the limit is on the code, not on
      // whether the guess happened to be right.
      expect(await guess(guardian.id, issued.code, fx.authUserId)).toBe(
        PatientsErrorCode.ClaimCodeLocked,
      );
    });
  });

  describe('the stored value is a keyed HMAC, not a bare digest', () => {
    it('is not recoverable by hashing the code', async () => {
      // Six digits is a million candidates. If the stored value were
      // sha256(code), a leaked table would give up every live code in seconds.
      const { guardian, issued } = await setup();
      const stored = await storedHashFor(guardian.id);

      expect(stored).not.toBe(
        createHash('sha256').update(issued.code).digest('hex'),
      );
    });

    it('matches the HMAC under the configured pepper', async () => {
      const { guardian, issued } = await setup();
      const stored = await storedHashFor(guardian.id);

      expect(stored).toBe(
        createHmac('sha256', testConfig().security.claimCodePepper)
          .update(issued.code)
          .digest('hex'),
      );
    });

    it('cannot be verified under a different pepper', async () => {
      // The property that matters: the database alone is not enough.
      const { guardian, issued } = await setup();
      const stored = await storedHashFor(guardian.id);

      expect(stored).not.toBe(
        createHmac('sha256', 'a-different-secret-of-adequate-length-here')
          .update(issued.code)
          .digest('hex'),
      );
    });

    it('still accepts the correct code, exactly once', async () => {
      const { guardian, issued } = await setup();

      expect(await guess(guardian.id, issued.code, fx.authUserId)).toBe(
        'claimed',
      );
      expect(await guess(guardian.id, issued.code, fx.otherAuthUserId)).toBe(
        PatientsErrorCode.ClaimCodeInvalid,
      );

      await fx.db.database.query(
        `update clinic.guardians
            set auth_user_id = null, claimed_at = null, claimed_via = null
          where id = $1`,
        [guardian.id],
      );
    });
  });

  it('still admits exactly one winner when two users race the same code', async () => {
    const { guardian, issued } = await setup('Race');

    const outcomes = await Promise.all([
      guess(guardian.id, issued.code, fx.authUserId),
      guess(guardian.id, issued.code, fx.otherAuthUserId),
    ]);

    expect(outcomes.filter((o) => o === 'claimed')).toHaveLength(1);

    const linked = await fx.db.database.query<{ auth_user_id: string | null }>(
      `select auth_user_id from clinic.guardians where id = $1`,
      [guardian.id],
    );
    expect(linked.rows[0].auth_user_id).not.toBeNull();

    await fx.db.database.query(
      `update clinic.guardians
          set auth_user_id = null, claimed_at = null, claimed_via = null
        where id = $1`,
      [guardian.id],
    );
  });
});
