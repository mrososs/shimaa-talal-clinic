import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ClinicMemberRole,
  ClinicMemberStatus,
  UserRole,
} from '@clinic/contracts';
import type { AuthenticatedRequest } from './authenticated-request';
import type { AuthenticatedUser } from './authenticated-user';
import type { ClinicMemberContext } from './clinic-member-resolver';
import type { GuardianContext } from './guardian-resolver';
import { ROLES_KEY } from './roles.decorator';
import { RolesGuard } from './roles.guard';

/**
 * Two things are being asserted here, and the second matters as much as the
 * first: that the right callers are let through, and that a route only pays for
 * the lookups it actually declared it needs.
 */

const AUTH_USER: AuthenticatedUser = {
  id: 'auth-user-1',
  email: 'someone@example.test',
  roles: [],
};

const GUARDIAN: GuardianContext = { id: 'guardian-1', clinicId: 'clinic-1' };

const RECEPTION: ClinicMemberContext = {
  id: 'member-1',
  clinicId: 'clinic-1',
  role: ClinicMemberRole.Reception,
  status: ClinicMemberStatus.Active,
};

const DOCTOR: ClinicMemberContext = {
  ...RECEPTION,
  id: 'member-2',
  role: ClinicMemberRole.Doctor,
};

interface Harness {
  guard: RolesGuard;
  request: AuthenticatedRequest;
  context: ExecutionContext;
  resolveGuardian: jest.Mock;
  resolveMember: jest.Mock;
}

function harness(
  options: {
    required?: UserRole[];
    guardian?: GuardianContext | null;
    member?: ClinicMemberContext | null;
    authenticated?: boolean;
  } = {},
): Harness {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(options.required);

  const resolveGuardian = jest.fn().mockResolvedValue(options.guardian ?? null);
  const resolveMember = jest.fn().mockResolvedValue(options.member ?? null);

  const request: AuthenticatedRequest = {
    headers: {},
    ...(options.authenticated === false ? {} : { user: { ...AUTH_USER } }),
  };

  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return {
    guard: new RolesGuard(
      reflector,
      { resolveByAuthUserId: resolveGuardian },
      { resolveByAuthUserId: resolveMember },
    ),
    request,
    context,
    resolveGuardian,
    resolveMember,
  };
}

describe('RolesGuard', () => {
  describe('routes with no @Roles()', () => {
    it.each([
      ['no metadata', undefined],
      ['an empty list', [] as UserRole[]],
    ])('allows through on %s', async (_label, required) => {
      const h = harness({ required });

      await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
    });

    it('resolves nothing, so an unguarded route costs no queries', async () => {
      // `GET /me` has to answer for a user who is neither a guardian nor staff.
      const h = harness({ required: undefined });

      await h.guard.canActivate(h.context);

      expect(h.resolveGuardian).not.toHaveBeenCalled();
      expect(h.resolveMember).not.toHaveBeenCalled();
      expect(h.request.context).toBeUndefined();
    });
  });

  describe('guardian routes', () => {
    it('admits a guardian and exposes them on the request', async () => {
      const h = harness({ required: [UserRole.Guardian], guardian: GUARDIAN });

      await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
      expect(h.request.context?.guardian).toEqual(GUARDIAN);
      expect(h.request.user?.roles).toEqual([UserRole.Guardian]);
      expect(h.request.context?.clinicId).toBe('clinic-1');
    });

    it('refuses a signed-in user who has not completed onboarding', async () => {
      const h = harness({ required: [UserRole.Guardian], guardian: null });

      await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('does not look up staff membership', async () => {
      const h = harness({ required: [UserRole.Guardian], guardian: GUARDIAN });

      await h.guard.canActivate(h.context);

      expect(h.resolveGuardian).toHaveBeenCalledWith(AUTH_USER.id);
      expect(h.resolveMember).not.toHaveBeenCalled();
    });
  });

  describe('staff routes', () => {
    it('admits a member whose role is listed', async () => {
      const h = harness({
        required: [UserRole.Reception, UserRole.Admin],
        member: RECEPTION,
      });

      await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
      expect(h.request.context?.member).toEqual(RECEPTION);
      expect(h.request.context?.clinicId).toBe('clinic-1');
      expect(h.request.user?.roles).toEqual([UserRole.Reception]);
    });

    it('refuses a member whose role is not listed', async () => {
      // A doctor may not check patients in; that is reception's job.
      const h = harness({ required: [UserRole.Reception], member: DOCTOR });

      await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses a user who is not staff anywhere', async () => {
      const h = harness({ required: [UserRole.Doctor], member: null });

      await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses a suspended member, and says so', async () => {
      // Offboarding is a status change, not a deletion, so this is the normal
      // path for a former member rather than an exotic one.
      const h = harness({
        required: [UserRole.Reception],
        member: { ...RECEPTION, status: ClinicMemberStatus.Suspended },
      });

      await expect(h.guard.canActivate(h.context)).rejects.toThrow(
        'This clinic account is suspended.',
      );
    });

    it('does not look up a guardian', async () => {
      const h = harness({ required: [UserRole.Doctor], member: DOCTOR });

      await h.guard.canActivate(h.context);

      expect(h.resolveMember).toHaveBeenCalledWith(AUTH_USER.id);
      expect(h.resolveGuardian).not.toHaveBeenCalled();
    });
  });

  describe('routes open to both', () => {
    it('resolves both and prefers the staff clinic for tenancy', async () => {
      const h = harness({
        required: [UserRole.Guardian, UserRole.Doctor],
        guardian: { id: 'guardian-1', clinicId: 'clinic-guardian' },
        member: { ...DOCTOR, clinicId: 'clinic-staff' },
      });

      await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
      expect(h.request.user?.roles).toEqual([
        UserRole.Guardian,
        UserRole.Doctor,
      ]);
      expect(h.request.context?.clinicId).toBe('clinic-staff');
    });

    it('admits on either one alone', async () => {
      const asGuardian = harness({
        required: [UserRole.Guardian, UserRole.Doctor],
        guardian: GUARDIAN,
        member: null,
      });
      await expect(
        asGuardian.guard.canActivate(asGuardian.context),
      ).resolves.toBe(true);

      const asDoctor = harness({
        required: [UserRole.Guardian, UserRole.Doctor],
        guardian: null,
        member: DOCTOR,
      });
      await expect(asDoctor.guard.canActivate(asDoctor.context)).resolves.toBe(
        true,
      );
    });
  });

  describe('safety', () => {
    it('rejects when no user was established', async () => {
      // Reached by combining @Public() with @Roles(), which is a mistake.
      const h = harness({
        required: [UserRole.Guardian],
        authenticated: false,
      });

      await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(h.resolveGuardian).not.toHaveBeenCalled();
    });

    it('replaces the user rather than mutating it', async () => {
      // CachedTokenVerifier may hand the same object to several requests;
      // writing roles onto it would leak one request into the next.
      const h = harness({ required: [UserRole.Guardian], guardian: GUARDIAN });
      const original = h.request.user;

      await h.guard.canActivate(h.context);

      expect(h.request.user).not.toBe(original);
      expect(original?.roles).toEqual([]);
    });

    it('reads handler metadata ahead of controller metadata', async () => {
      const reflector = new Reflector();
      const spy = jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(undefined);
      const guard = new RolesGuard(
        reflector,
        { resolveByAuthUserId: jest.fn() },
        { resolveByAuthUserId: jest.fn() },
      );
      const { context } = harness();

      await guard.canActivate(context);

      const [key, targets] = spy.mock.calls[0];
      expect(key).toBe(ROLES_KEY);
      expect(targets).toHaveLength(2);
    });
  });
});
