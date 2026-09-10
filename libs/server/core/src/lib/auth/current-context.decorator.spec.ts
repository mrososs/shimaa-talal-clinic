import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ClinicMemberRole, ClinicMemberStatus } from '@clinic/contracts';
import { requireGuardian, requireMember } from './current-context.decorator';
import { requireUser } from './current-user.decorator';
import type { AuthenticatedUser } from './authenticated-user';
import type { ClinicMemberContext } from './clinic-member-resolver';
import type { GuardianContext } from './guardian-resolver';
import type { RequestContext } from './request-context';

const USER: AuthenticatedUser = {
  id: 'auth-user-1',
  email: 'someone@example.test',
  phone: null,
  roles: [],
};
const GUARDIAN: GuardianContext = { id: 'guardian-1', clinicId: 'clinic-1' };
const MEMBER: ClinicMemberContext = {
  id: 'member-1',
  clinicId: 'clinic-1',
  role: ClinicMemberRole.Reception,
  status: ClinicMemberStatus.Active,
};

function contextWith(partial: Partial<RequestContext>): RequestContext {
  return {
    authUser: USER,
    guardian: null,
    member: null,
    clinicId: null,
    ...partial,
  };
}

/**
 * These decorators promise handlers a non-null value. If that promise is ever
 * broken quietly — a `null` reaching a handler that then reads `.id` — the
 * failure surfaces as a 500 in production rather than a refusal here.
 */
describe('requireGuardian', () => {
  it('returns the guardian when the route resolved one', () => {
    expect(requireGuardian(contextWith({ guardian: GUARDIAN }))).toBe(GUARDIAN);
  });

  it.each([
    ['no context at all', undefined],
    ['a context with no guardian', contextWith({ member: MEMBER })],
  ])('refuses on %s', (_label, context) => {
    expect(() => requireGuardian(context)).toThrow(ForbiddenException);
  });

  it('does not accept a staff member in a guardian slot', () => {
    // A doctor is authenticated and authorised for their own routes; that must
    // not make them the guardian of somebody's child.
    expect(() => requireGuardian(contextWith({ member: MEMBER }))).toThrow(
      'This account does not have access to that resource.',
    );
  });
});

describe('requireMember', () => {
  it('returns the member when the route resolved one', () => {
    expect(requireMember(contextWith({ member: MEMBER }))).toBe(MEMBER);
  });

  it.each([
    ['no context at all', undefined],
    ['a context with no member', contextWith({ guardian: GUARDIAN })],
  ])('refuses on %s', (_label, context) => {
    expect(() => requireMember(context)).toThrow(ForbiddenException);
  });

  it('carries the clinic the request acts within', () => {
    // Tenant scoping reads this, never a request body.
    expect(requireMember(contextWith({ member: MEMBER })).clinicId).toBe(
      'clinic-1',
    );
  });
});

describe('requireUser', () => {
  it('returns the verified caller', () => {
    expect(requireUser(USER)).toBe(USER);
  });

  it('refuses when the guard never ran', () => {
    // Only reachable by combining @Public() with @CurrentUser().
    expect(() => requireUser(undefined)).toThrow(UnauthorizedException);
  });
});
