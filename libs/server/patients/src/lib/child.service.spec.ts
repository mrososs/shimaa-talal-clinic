import { ChildService } from './child.service';
import { GuardianOwnershipService } from './guardian-ownership.service';
import { GuardianService } from './guardian.service';
import { PatientsErrorCode } from './patients.errors';
import { REGION, describeWithDatabase, uniquePhone } from './patients.fixture';

describeWithDatabase('ChildService and ownership', (fx) => {
  const children = () => new ChildService(fx.db.database);
  const guardians = () => new GuardianService(fx.db.database);
  const ownership = () => new GuardianOwnershipService(fx.db.database);

  const newGuardian = (clinicId = fx.clinicId, name = 'Parent') =>
    guardians().create({
      clinicId,
      region: REGION,
      fullName: name,
      phone: uniquePhone(),
    });

  describe('creating and linking', () => {
    it('creates a child and attaches it to a guardian as one unit', async () => {
      const guardian = await newGuardian();

      const child = await children().createForGuardian({
        clinicId: fx.clinicId,
        guardianId: guardian.id,
        fullName: 'Leen',
        dateOfBirth: '2021-06-12',
        sex: 'female',
        relationship: 'mother',
        isPrimary: true,
      });

      expect(child.fullName).toBe('Leen');
      // A date column has no zone; the day must survive the round trip intact.
      expect(child.dateOfBirth).toBe('2021-06-12');

      const listed = await children().listForGuardian(fx.clinicId, guardian.id);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        id: child.id,
        relationship: 'mother',
        isPrimary: true,
      });
    });

    it('lets a child have several guardians', async () => {
      // The reason guardian_children exists: a child has a mother and a father,
      // and often a grandparent who actually brings them in.
      const mother = await newGuardian(fx.clinicId, 'Mother');
      const father = await newGuardian(fx.clinicId, 'Father');

      const child = await children().createForGuardian({
        clinicId: fx.clinicId,
        guardianId: mother.id,
        fullName: 'Shared Child',
        relationship: 'mother',
        isPrimary: true,
      });
      await children().link({
        clinicId: fx.clinicId,
        guardianId: father.id,
        childId: child.id,
        relationship: 'father',
      });

      expect(
        await children().listForGuardian(fx.clinicId, father.id),
      ).toHaveLength(1);
      expect(
        await children().listForGuardian(fx.clinicId, mother.id),
      ).toHaveLength(1);
    });

    it('allows only one primary caregiver per child', async () => {
      const mother = await newGuardian(fx.clinicId, 'Primary Mother');
      const father = await newGuardian(fx.clinicId, 'Would-be Primary');

      const child = await children().createForGuardian({
        clinicId: fx.clinicId,
        guardianId: mother.id,
        fullName: 'One Primary',
        relationship: 'mother',
        isPrimary: true,
      });

      await expect(
        children().link({
          clinicId: fx.clinicId,
          guardianId: father.id,
          childId: child.id,
          relationship: 'father',
          isPrimary: true,
        }),
      ).rejects.toMatchObject({
        code: PatientsErrorCode.PrimaryGuardianTaken,
      });
    });

    it('re-linking updates the relationship rather than failing', async () => {
      const guardian = await newGuardian(fx.clinicId, 'Relabelled');
      const child = await children().createForGuardian({
        clinicId: fx.clinicId,
        guardianId: guardian.id,
        fullName: 'Relabel Me',
        relationship: 'other',
      });

      await children().link({
        clinicId: fx.clinicId,
        guardianId: guardian.id,
        childId: child.id,
        relationship: 'grandparent',
      });

      const listed = await children().listForGuardian(fx.clinicId, guardian.id);
      expect(listed[0].relationship).toBe('grandparent');
    });
  });

  describe('tenant isolation', () => {
    it('refuses to link a child from another clinic', async () => {
      const here = await newGuardian(fx.clinicId, 'Here');
      const elsewhere = await newGuardian(fx.otherClinicId, 'Elsewhere');
      const foreignChild = await children().createForGuardian({
        clinicId: fx.otherClinicId,
        guardianId: elsewhere.id,
        fullName: 'Foreign Child',
        relationship: 'mother',
      });

      await expect(
        children().link({
          clinicId: fx.clinicId,
          guardianId: here.id,
          childId: foreignChild.id,
          relationship: 'mother',
        }),
      ).rejects.toMatchObject({ code: PatientsErrorCode.ChildNotFound });
    });

    it('does not read a child from another clinic by id', async () => {
      const elsewhere = await newGuardian(fx.otherClinicId, 'Owner Elsewhere');
      const child = await children().createForGuardian({
        clinicId: fx.otherClinicId,
        guardianId: elsewhere.id,
        fullName: 'Hidden',
        relationship: 'mother',
      });

      expect(await children().findById(fx.clinicId, child.id)).toBeNull();
    });

    it('does not update a child from another clinic', async () => {
      const elsewhere = await newGuardian(fx.otherClinicId, 'Owner B');
      const child = await children().createForGuardian({
        clinicId: fx.otherClinicId,
        guardianId: elsewhere.id,
        fullName: 'Untouchable',
        relationship: 'mother',
      });

      await expect(
        children().update(fx.clinicId, child.id, { fullName: 'Renamed' }),
      ).rejects.toMatchObject({ code: PatientsErrorCode.ChildNotFound });
    });

    it('lists nothing for a guardian whose children are at another clinic', async () => {
      const elsewhere = await newGuardian(fx.otherClinicId, 'Cross Clinic');
      await children().createForGuardian({
        clinicId: fx.otherClinicId,
        guardianId: elsewhere.id,
        fullName: 'Theirs',
        relationship: 'mother',
      });

      expect(
        await children().listForGuardian(fx.clinicId, elsewhere.id),
      ).toHaveLength(0);
    });
  });

  describe('GuardianOwnershipService', () => {
    it('says yes for the guardian the child is linked to', async () => {
      const guardian = await newGuardian(fx.clinicId, 'Owner');
      const child = await children().createForGuardian({
        clinicId: fx.clinicId,
        guardianId: guardian.id,
        fullName: 'Owned',
        relationship: 'mother',
      });

      await expect(
        ownership().canAccessChild(fx.clinicId, guardian.id, child.id),
      ).resolves.toBe(true);
    });

    it('says no for an unrelated guardian in the same clinic', async () => {
      const owner = await newGuardian(fx.clinicId, 'Real Owner');
      const stranger = await newGuardian(fx.clinicId, 'Stranger');
      const child = await children().createForGuardian({
        clinicId: fx.clinicId,
        guardianId: owner.id,
        fullName: 'Not Yours',
        relationship: 'mother',
      });

      await expect(
        ownership().canAccessChild(fx.clinicId, stranger.id, child.id),
      ).resolves.toBe(false);
    });

    it('says no when the link exists but the clinic does not match', async () => {
      // Both rows exist and are genuinely related — but not in this tenant.
      const guardian = await newGuardian(fx.otherClinicId, 'Other Tenant');
      const child = await children().createForGuardian({
        clinicId: fx.otherClinicId,
        guardianId: guardian.id,
        fullName: 'Other Tenant Child',
        relationship: 'mother',
      });

      await expect(
        ownership().canAccessChild(fx.clinicId, guardian.id, child.id),
      ).resolves.toBe(false);
    });

    it('refuses as "no such child", not "not yours"', async () => {
      // The difference between those two answers is itself information about
      // somebody else's patient.
      const stranger = await newGuardian(fx.clinicId, 'Prober');
      const owner = await newGuardian(fx.clinicId, 'Owner C');
      const child = await children().createForGuardian({
        clinicId: fx.clinicId,
        guardianId: owner.id,
        fullName: 'Probed',
        relationship: 'mother',
      });

      await expect(
        ownership().assertCanAccessChild(fx.clinicId, stranger.id, child.id),
      ).rejects.toMatchObject({ code: PatientsErrorCode.ChildNotFound });
    });

    it('lists the child ids a guardian may act for', async () => {
      const guardian = await newGuardian(fx.clinicId, 'Multi');
      const first = await children().createForGuardian({
        clinicId: fx.clinicId,
        guardianId: guardian.id,
        fullName: 'First',
        relationship: 'mother',
      });
      const second = await children().createForGuardian({
        clinicId: fx.clinicId,
        guardianId: guardian.id,
        fullName: 'Second',
        relationship: 'mother',
      });

      const ids = await ownership().accessibleChildIds(
        fx.clinicId,
        guardian.id,
      );
      expect(ids.sort()).toEqual([first.id, second.id].sort());
    });
  });
});
