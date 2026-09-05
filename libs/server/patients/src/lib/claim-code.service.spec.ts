import { createHash } from 'node:crypto';
import {
  CLAIM_CODE_MAX_ATTEMPTS,
  CLAIM_CODE_TTL_MINUTES,
  ClaimCodeService,
} from './claim-code.service';
import { GuardianService } from './guardian.service';
import { PatientsErrorCode } from './patients.errors';
import { REGION, describeWithDatabase, uniquePhone } from './patients.fixture';

/**
 * Claiming is the one place a stranger can reach an existing family's records,
 * so almost every assertion here is about refusal.
 */
describeWithDatabase('ClaimCodeService', (fx) => {
  const guardians = () => new GuardianService(fx.db.database);
  const claims = () =>
    new ClaimCodeService(fx.db.database, new GuardianService(fx.db.database));

  const unclaimedGuardian = (name = 'Unclaimed') =>
    guardians().create({
      clinicId: fx.clinicId,
      region: REGION,
      fullName: name,
      phone: uniquePhone(),
    });

  /** Frees the shared auth user so later tests can link it again. */
  async function unlink(guardianId: string): Promise<void> {
    await fx.db.database.query(
      `update clinic.guardians
          set auth_user_id = null, claimed_at = null, claimed_via = null
        where id = $1`,
      [guardianId],
    );
  }

  describe('issuing', () => {
    it('returns a six-digit code and an expiry', async () => {
      const guardian = await unclaimedGuardian();

      const issued = await claims().issue(
        fx.clinicId,
        guardian.id,
        fx.memberId,
      );

      expect(issued.code).toMatch(/^\d{6}$/);
      const minutesAway = (Date.parse(issued.expiresAt) - Date.now()) / 60_000;
      expect(minutesAway).toBeGreaterThan(CLAIM_CODE_TTL_MINUTES - 2);
      expect(minutesAway).toBeLessThanOrEqual(CLAIM_CODE_TTL_MINUTES);
    });

    it('stores only a digest, never the code itself', async () => {
      // A database leak must not hand over a set of working claim codes.
      const guardian = await unclaimedGuardian();
      const issued = await claims().issue(
        fx.clinicId,
        guardian.id,
        fx.memberId,
      );

      const row = await fx.db.database.query<{ code_hash: string }>(
        `select code_hash from clinic.guardian_claim_codes where guardian_id = $1`,
        [guardian.id],
      );

      expect(row.rows[0].code_hash).not.toContain(issued.code);
      expect(row.rows[0].code_hash).toBe(
        createHash('sha256').update(issued.code).digest('hex'),
      );
    });

    it('replaces a previous code rather than leaving two live', async () => {
      const guardian = await unclaimedGuardian();
      const first = await claims().issue(fx.clinicId, guardian.id, fx.memberId);
      const second = await claims().issue(
        fx.clinicId,
        guardian.id,
        fx.memberId,
      );

      await expect(
        claims().claim({
          clinicId: fx.clinicId,
          guardianId: guardian.id,
          code: first.code,
          authUserId: fx.authUserId,
        }),
      ).rejects.toMatchObject({ code: PatientsErrorCode.ClaimCodeInvalid });

      const linked = await claims().claim({
        clinicId: fx.clinicId,
        guardianId: guardian.id,
        code: second.code,
        authUserId: fx.authUserId,
      });
      expect(linked.hasAccount).toBe(true);
      await unlink(guardian.id);
    });

    it('refuses to issue for a guardian that already has an account', async () => {
      const guardian = await unclaimedGuardian();
      await guardians().linkAuthUser(
        fx.clinicId,
        guardian.id,
        fx.authUserId,
        'self_signup',
      );

      await expect(
        claims().issue(fx.clinicId, guardian.id, fx.memberId),
      ).rejects.toMatchObject({
        code: PatientsErrorCode.GuardianAlreadyClaimed,
      });
      await unlink(guardian.id);
    });

    it('refuses to issue for a guardian at another clinic', async () => {
      const elsewhere = await guardians().create({
        clinicId: fx.otherClinicId,
        region: REGION,
        fullName: 'Other Tenant',
        phone: uniquePhone(),
      });

      await expect(
        claims().issue(fx.clinicId, elsewhere.id, fx.memberId),
      ).rejects.toMatchObject({ code: PatientsErrorCode.GuardianNotFound });
    });
  });

  describe('claiming', () => {
    it('links the guardian to the calling account', async () => {
      const guardian = await unclaimedGuardian();
      const issued = await claims().issue(
        fx.clinicId,
        guardian.id,
        fx.memberId,
      );

      const linked = await claims().claim({
        clinicId: fx.clinicId,
        guardianId: guardian.id,
        code: issued.code,
        authUserId: fx.authUserId,
      });

      expect(linked.id).toBe(guardian.id);
      expect(linked.hasAccount).toBe(true);
      await unlink(guardian.id);
    });

    it('rejects a wrong code', async () => {
      const guardian = await unclaimedGuardian();
      const issued = await claims().issue(
        fx.clinicId,
        guardian.id,
        fx.memberId,
      );
      const wrong = issued.code === '000000' ? '111111' : '000000';

      await expect(
        claims().claim({
          clinicId: fx.clinicId,
          guardianId: guardian.id,
          code: wrong,
          authUserId: fx.authUserId,
        }),
      ).rejects.toMatchObject({ code: PatientsErrorCode.ClaimCodeInvalid });

      const after = await guardians().findById(fx.clinicId, guardian.id);
      expect(after?.hasAccount).toBe(false);
    });

    it('rejects a code that has expired', async () => {
      const guardian = await unclaimedGuardian();
      const issued = await claims().issue(
        fx.clinicId,
        guardian.id,
        fx.memberId,
      );
      await fx.db.database.query(
        `update clinic.guardian_claim_codes
            set expires_at = now() - interval '1 minute'
          where guardian_id = $1 and consumed_at is null`,
        [guardian.id],
      );

      await expect(
        claims().claim({
          clinicId: fx.clinicId,
          guardianId: guardian.id,
          code: issued.code,
          authUserId: fx.authUserId,
        }),
      ).rejects.toMatchObject({ code: PatientsErrorCode.ClaimCodeExpired });
    });

    it('rejects a code that was already used', async () => {
      const guardian = await unclaimedGuardian();
      const issued = await claims().issue(
        fx.clinicId,
        guardian.id,
        fx.memberId,
      );
      await claims().claim({
        clinicId: fx.clinicId,
        guardianId: guardian.id,
        code: issued.code,
        authUserId: fx.authUserId,
      });

      await expect(
        claims().claim({
          clinicId: fx.clinicId,
          guardianId: guardian.id,
          code: issued.code,
          authUserId: fx.otherAuthUserId,
        }),
      ).rejects.toMatchObject({ code: PatientsErrorCode.ClaimCodeInvalid });
      await unlink(guardian.id);
    });

    it('rejects when there is no code at all', async () => {
      const guardian = await unclaimedGuardian();

      await expect(
        claims().claim({
          clinicId: fx.clinicId,
          guardianId: guardian.id,
          code: '123456',
          authUserId: fx.authUserId,
        }),
      ).rejects.toMatchObject({ code: PatientsErrorCode.ClaimCodeInvalid });
    });

    it('stops accepting guesses after too many wrong ones', async () => {
      // 10^6 is a wide space, but a code that can be hammered is not a secret.
      const guardian = await unclaimedGuardian();
      const issued = await claims().issue(
        fx.clinicId,
        guardian.id,
        fx.memberId,
      );
      const wrong = issued.code === '000000' ? '111111' : '000000';

      for (let i = 0; i < CLAIM_CODE_MAX_ATTEMPTS; i += 1) {
        await expect(
          claims().claim({
            clinicId: fx.clinicId,
            guardianId: guardian.id,
            code: wrong,
            authUserId: fx.authUserId,
          }),
        ).rejects.toMatchObject({ code: PatientsErrorCode.ClaimCodeInvalid });
      }

      // Even the correct code is refused now.
      await expect(
        claims().claim({
          clinicId: fx.clinicId,
          guardianId: guardian.id,
          code: issued.code,
          authUserId: fx.authUserId,
        }),
      ).rejects.toMatchObject({ code: PatientsErrorCode.ClaimCodeLocked });
    });

    it('refuses a guardian that someone else already claimed', async () => {
      const guardian = await unclaimedGuardian();
      const issued = await claims().issue(
        fx.clinicId,
        guardian.id,
        fx.memberId,
      );
      await guardians().linkAuthUser(
        fx.clinicId,
        guardian.id,
        fx.otherAuthUserId,
        'self_signup',
      );

      await expect(
        claims().claim({
          clinicId: fx.clinicId,
          guardianId: guardian.id,
          code: issued.code,
          authUserId: fx.authUserId,
        }),
      ).rejects.toMatchObject({
        code: PatientsErrorCode.GuardianAlreadyClaimed,
      });

      // The failed claim must not have burned the code's consumption record
      // against a link that never happened.
      const row = await fx.db.database.query<{ consumed_at: Date | null }>(
        `select consumed_at from clinic.guardian_claim_codes where guardian_id = $1`,
        [guardian.id],
      );
      expect(row.rows[0].consumed_at).toBeNull();

      await unlink(guardian.id);
    });

    it('links to exactly one account when two users race with the same code', async () => {
      const guardian = await unclaimedGuardian();
      const issued = await claims().issue(
        fx.clinicId,
        guardian.id,
        fx.memberId,
      );

      const attempt = (authUserId: string) =>
        claims()
          .claim({
            clinicId: fx.clinicId,
            guardianId: guardian.id,
            code: issued.code,
            authUserId,
          })
          .then(
            () => 'claimed' as const,
            (error: { code?: string }) => error.code,
          );

      const outcomes = await Promise.all([
        attempt(fx.authUserId),
        attempt(fx.otherAuthUserId),
      ]);

      expect(outcomes.filter((o) => o === 'claimed')).toHaveLength(1);

      const linked = await fx.db.database.query<{ auth_user_id: string }>(
        `select auth_user_id from clinic.guardians where id = $1`,
        [guardian.id],
      );
      expect(linked.rows[0].auth_user_id).not.toBeNull();

      await unlink(guardian.id);
    });
  });

  describe('hasUnclaimedGuardianForPhone', () => {
    it('is true for a family the clinic knows and nobody has claimed', async () => {
      const phone = uniquePhone();
      await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: 'Known',
        phone,
      });

      await expect(
        claims().hasUnclaimedGuardianForPhone(fx.clinicId, phone, REGION),
      ).resolves.toBe(true);
    });

    it('is false for an unknown phone', async () => {
      await expect(
        claims().hasUnclaimedGuardianForPhone(
          fx.clinicId,
          uniquePhone(),
          REGION,
        ),
      ).resolves.toBe(false);
    });

    it('is false once the family has an account, so the two look identical', async () => {
      // A claimed phone and an unknown phone must be indistinguishable, or the
      // check becomes a way to discover who is registered.
      const phone = uniquePhone();
      const guardian = await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: 'Already Has One',
        phone,
      });
      await guardians().linkAuthUser(
        fx.clinicId,
        guardian.id,
        fx.authUserId,
        'self_signup',
      );

      await expect(
        claims().hasUnclaimedGuardianForPhone(fx.clinicId, phone, REGION),
      ).resolves.toBe(false);
      await unlink(guardian.id);
    });

    it('does not see a family at another clinic', async () => {
      const phone = uniquePhone();
      await guardians().create({
        clinicId: fx.otherClinicId,
        region: REGION,
        fullName: 'Elsewhere',
        phone,
      });

      await expect(
        claims().hasUnclaimedGuardianForPhone(fx.clinicId, phone, REGION),
      ).resolves.toBe(false);
    });
  });
});
