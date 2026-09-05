import { GuardianService } from './guardian.service';
import { PatientsGuardianResolver } from './patients-guardian.resolver';
import { PatientsErrorCode } from './patients.errors';
import { REGION, describeWithDatabase, uniquePhone } from './patients.fixture';

/**
 * Against a real PostgreSQL server, because the rules being asserted are the
 * database's: a unique index decides that two receptionists cannot create the
 * same family twice, and a WHERE clause decides that one clinic cannot read
 * another's. Neither survives being mocked.
 */
describeWithDatabase('GuardianService', (fx) => {
  const guardians = () => new GuardianService(fx.db.database);

  describe('create', () => {
    it('creates a guardian with no account, which is the reception case', async () => {
      const guardian = await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: '  Mahmoud Adel  ',
        phone: uniquePhone(),
        createdByMemberId: fx.memberId,
      });

      // The family exists and is bookable before anyone installs anything.
      expect(guardian.hasAccount).toBe(false);
      expect(guardian.clinicId).toBe(fx.clinicId);
      expect(guardian.fullName).toBe('Mahmoud Adel');
    });

    it('stores the phone in E.164 however it was typed', async () => {
      const local = uniquePhone();
      const guardian = await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: 'Local Format',
        phone: `0${local.slice(1, 4)} ${local.slice(4, 8)} ${local.slice(8)}`,
      });

      expect(guardian.phoneE164).toBe(`+20${local.slice(1)}`);
    });

    it('refuses a phone it cannot read, rather than storing something unusable', async () => {
      await expect(
        guardians().create({
          clinicId: fx.clinicId,
          region: REGION,
          fullName: 'Bad Phone',
          phone: 'not a phone',
        }),
      ).rejects.toMatchObject({ code: PatientsErrorCode.InvalidPhone });
    });

    it('reports a duplicate phone instead of creating a second family', async () => {
      const phone = uniquePhone();
      await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: 'First',
        phone,
      });

      await expect(
        guardians().create({
          clinicId: fx.clinicId,
          region: REGION,
          fullName: 'Second',
          phone,
        }),
      ).rejects.toMatchObject({ code: PatientsErrorCode.GuardianPhoneTaken });
    });

    it('treats the same number typed two ways as the same family', async () => {
      const local = uniquePhone();
      await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: 'Typed Locally',
        phone: local,
      });

      // Normalisation is what makes this a conflict rather than a duplicate.
      await expect(
        guardians().create({
          clinicId: fx.clinicId,
          region: REGION,
          fullName: 'Typed Internationally',
          phone: `+20${local.slice(1)}`,
        }),
      ).rejects.toMatchObject({ code: PatientsErrorCode.GuardianPhoneTaken });
    });

    it('allows the same phone at a different clinic', async () => {
      const phone = uniquePhone();
      await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: 'At Clinic A',
        phone,
      });

      // Uniqueness is per tenant; two clinics may serve the same person.
      const other = await guardians().create({
        clinicId: fx.otherClinicId,
        region: REGION,
        fullName: 'At Clinic B',
        phone,
      });
      expect(other.clinicId).toBe(fx.otherClinicId);
    });
  });

  describe('lookup', () => {
    it('finds by phone in local format', async () => {
      const phone = uniquePhone();
      const created = await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: 'Findable',
        phone: `+20${phone.slice(1)}`,
      });

      // The receptionist types what is on the caller ID.
      const found = await guardians().findByPhone(fx.clinicId, phone, REGION);
      expect(found?.id).toBe(created.id);
    });

    it('does not find a guardian from another clinic by phone', async () => {
      const phone = uniquePhone();
      await guardians().create({
        clinicId: fx.otherClinicId,
        region: REGION,
        fullName: 'Elsewhere',
        phone,
      });

      expect(
        await guardians().findByPhone(fx.clinicId, phone, REGION),
      ).toBeNull();
    });

    it('does not find a guardian from another clinic by id', async () => {
      const elsewhere = await guardians().create({
        clinicId: fx.otherClinicId,
        region: REGION,
        fullName: 'Elsewhere By Id',
        phone: uniquePhone(),
      });

      expect(await guardians().findById(fx.clinicId, elsewhere.id)).toBeNull();
    });

    it('searches by name fragment within the clinic only', async () => {
      const marker = `Zz${Date.now().toString(36)}`;
      await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: `${marker} Here`,
        phone: uniquePhone(),
      });
      await guardians().create({
        clinicId: fx.otherClinicId,
        region: REGION,
        fullName: `${marker} There`,
        phone: uniquePhone(),
      });

      const page = await guardians().search(fx.clinicId, { query: marker });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].fullName).toBe(`${marker} Here`);
      expect(page.meta.total).toBe(1);
    });
  });

  describe('update', () => {
    it('cannot be aimed at another clinic', async () => {
      const elsewhere = await guardians().create({
        clinicId: fx.otherClinicId,
        region: REGION,
        fullName: 'Not Yours',
        phone: uniquePhone(),
      });

      await expect(
        guardians().update(fx.clinicId, elsewhere.id, { fullName: 'Hijacked' }),
      ).rejects.toMatchObject({ code: PatientsErrorCode.GuardianNotFound });
    });

    it('reports a collision when a phone is changed onto an existing one', async () => {
      const taken = uniquePhone();
      await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: 'Holder',
        phone: taken,
      });
      const mover = await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: 'Mover',
        phone: uniquePhone(),
      });

      await expect(
        guardians().update(fx.clinicId, mover.id, {
          phone: taken,
          region: REGION,
        }),
      ).rejects.toMatchObject({ code: PatientsErrorCode.GuardianPhoneTaken });
    });
  });

  describe('linkAuthUser', () => {
    it('links an unclaimed guardian and reports it as having an account', async () => {
      const guardian = await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: 'To Link',
        phone: uniquePhone(),
      });

      const linked = await guardians().linkAuthUser(
        fx.clinicId,
        guardian.id,
        fx.authUserId,
        'claim_code',
      );
      expect(linked.hasAccount).toBe(true);

      await unlink(guardian.id);
    });

    it('refuses a guardian that is already linked', async () => {
      const guardian = await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: 'Already Linked',
        phone: uniquePhone(),
      });
      await guardians().linkAuthUser(
        fx.clinicId,
        guardian.id,
        fx.authUserId,
        'claim_code',
      );

      await expect(
        guardians().linkAuthUser(
          fx.clinicId,
          guardian.id,
          fx.otherAuthUserId,
          'claim_code',
        ),
      ).rejects.toMatchObject({
        code: PatientsErrorCode.GuardianAlreadyClaimed,
      });

      await unlink(guardian.id);
    });

    it('cannot link a guardian belonging to another clinic', async () => {
      const elsewhere = await guardians().create({
        clinicId: fx.otherClinicId,
        region: REGION,
        fullName: 'Other Tenant',
        phone: uniquePhone(),
      });

      await expect(
        guardians().linkAuthUser(
          fx.clinicId,
          elsewhere.id,
          fx.authUserId,
          'claim_code',
        ),
      ).rejects.toMatchObject({ code: PatientsErrorCode.GuardianNotFound });
    });
  });

  describe('concurrency', () => {
    it('creates one guardian, not two, when the same phone arrives twice at once', async () => {
      // Two receptionists taking the same call. The unique index decides; a
      // read-then-write would let both through.
      const phone = uniquePhone();
      const attempt = () =>
        guardians()
          .create({
            clinicId: fx.clinicId,
            region: REGION,
            fullName: 'Race',
            phone,
          })
          .then(
            () => 'created' as const,
            (error: { code?: string }) => error.code,
          );

      const outcomes = await Promise.all([attempt(), attempt()]);

      expect(outcomes.filter((o) => o === 'created')).toHaveLength(1);
      expect(outcomes).toContain(PatientsErrorCode.GuardianPhoneTaken);

      const rows = await fx.db.database.query<{ count: string }>(
        `select count(*)::text as count from clinic.guardians
          where clinic_id = $1 and phone_e164 = $2`,
        [fx.clinicId, `+20${phone.slice(1)}`],
      );
      expect(rows.rows[0].count).toBe('1');
    });

    it('links a guardian to one account when two users claim it at once', async () => {
      const guardian = await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: 'Contested',
        phone: uniquePhone(),
      });

      const attempt = (authUserId: string) =>
        guardians()
          .linkAuthUser(fx.clinicId, guardian.id, authUserId, 'claim_code')
          .then(
            () => 'linked' as const,
            (error: { code?: string }) => error.code,
          );

      const outcomes = await Promise.all([
        attempt(fx.authUserId),
        attempt(fx.otherAuthUserId),
      ]);

      expect(outcomes.filter((o) => o === 'linked')).toHaveLength(1);
      expect(
        outcomes.some(
          (o) =>
            o === PatientsErrorCode.GuardianAlreadyClaimed ||
            o === PatientsErrorCode.AuthUserAlreadyLinked,
        ),
      ).toBe(true);

      await unlink(guardian.id);
    });
  });

  describe('PatientsGuardianResolver', () => {
    const resolver = () =>
      new PatientsGuardianResolver(new GuardianService(fx.db.database));

    it('resolves a linked user to a guardian and its clinic', async () => {
      const guardian = await guardians().create({
        clinicId: fx.clinicId,
        region: REGION,
        fullName: 'Resolvable',
        phone: uniquePhone(),
      });
      await guardians().linkAuthUser(
        fx.clinicId,
        guardian.id,
        fx.authUserId,
        'claim_code',
      );

      await expect(
        resolver().resolveByAuthUserId(fx.authUserId),
      ).resolves.toEqual({ id: guardian.id, clinicId: fx.clinicId });

      await unlink(guardian.id);
    });

    it('returns null for a signed-in user who has not onboarded', async () => {
      // A normal state, not an authorisation failure: GET /me exists to say so.
      await expect(
        resolver().resolveByAuthUserId(fx.authUserId),
      ).resolves.toBeNull();
    });

    it('returns null for an auth user unknown to the clinic', async () => {
      await expect(
        resolver().resolveByAuthUserId('00000000-0000-0000-0000-000000000000'),
      ).resolves.toBeNull();
    });
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
});
