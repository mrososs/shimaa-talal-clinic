import type { AuthenticatedUser } from '@clinic/server-core';
import { GuardianRelationship } from '@clinic/contracts';
import { PatientsErrorCode } from '../patients.errors';
import { MeController } from './me.controller';

describe('MeController phone-auth onboarding', () => {
  const clinic = {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'pilot',
    name: 'Pilot',
    timezone: 'Africa/Cairo',
    defaultCountryCode: 'EG',
  };
  const phoneUser: AuthenticatedUser = {
    id: 'auth-phone-user',
    email: null,
    phone: '+201012345678',
    roles: [],
  };

  function setup() {
    const guardians = {
      findByAuthUserId: jest.fn().mockResolvedValue(null),
      createSelfRegistered: jest.fn().mockResolvedValue({ id: 'guardian-1' }),
    };
    const clinics = {
      findBySlug: jest.fn().mockResolvedValue(clinic),
    };
    const controller = new MeController(
      guardians as never,
      {} as never,
      {} as never,
      {} as never,
      clinics as never,
      { clinic: { slug: clinic.slug } } as never,
    );
    return { controller, guardians };
  }

  it('rejects a different phone before creating a guardian', async () => {
    const { controller, guardians } = setup();

    await expect(
      controller.createGuardian(phoneUser, {
        fullName: 'Phone Parent',
        phone: '+201512345678',
        relationship: GuardianRelationship.Mother,
      }),
    ).rejects.toMatchObject({
      code: PatientsErrorCode.VerifiedPhoneMismatch,
    });
    expect(guardians.createSelfRegistered).not.toHaveBeenCalled();
  });

  it('accepts the verified phone even when typed in local form', async () => {
    const { controller, guardians } = setup();

    await controller.createGuardian(phoneUser, {
      fullName: 'Phone Parent',
      phone: '010 1234 5678',
      relationship: GuardianRelationship.Mother,
    });

    expect(guardians.createSelfRegistered).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '010 1234 5678' }),
      phoneUser.id,
    );
  });

  it('keeps email-auth onboarding backward compatible', async () => {
    const { controller, guardians } = setup();
    await controller.createGuardian(
      { ...phoneUser, email: 'parent@example.test', phone: null },
      {
        fullName: 'Email Parent',
        phone: '011 1234 5678',
        relationship: GuardianRelationship.Father,
      },
    );

    expect(guardians.createSelfRegistered).toHaveBeenCalledTimes(1);
  });
});
