import {
  ForbiddenException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request';
import type { ClinicMemberContext } from './clinic-member-resolver';
import type { GuardianContext } from './guardian-resolver';
import type { RequestContext } from './request-context';

const NO_ACCESS = 'This account does not have access to that resource.';

/**
 * The checks these decorators perform, as plain functions.
 *
 * Split out because the body of a `createParamDecorator` is reachable only
 * through Nest's internal route-argument metadata, and a guard clause that
 * decides whether a request proceeds should not be the untested part of the
 * file.
 */
export function requireGuardian(
  context: RequestContext | undefined,
): GuardianContext {
  const guardian = context?.guardian;
  if (!guardian) {
    throw new ForbiddenException(NO_ACCESS);
  }
  return guardian;
}

export function requireMember(
  context: RequestContext | undefined,
): ClinicMemberContext {
  const member = context?.member;
  if (!member) {
    throw new ForbiddenException(NO_ACCESS);
  }
  return member;
}

function contextOf(context: ExecutionContext): RequestContext | undefined {
  return context.switchToHttp().getRequest<AuthenticatedRequest>()?.context;
}

/**
 * The guardian this request acts for.
 *
 * Non-nullable: it is populated only on routes that declared
 * `@Roles(UserRole.Guardian)`, and such a route cannot run without one. A
 * handler that must tolerate a missing guardian — onboarding, `/me` — should
 * call the resolver itself rather than declare a role it does not require.
 */
export const CurrentGuardian = createParamDecorator(
  (_data: unknown, context: ExecutionContext): GuardianContext =>
    requireGuardian(contextOf(context)),
);

/**
 * The staff member making this request, including the clinic they act within.
 *
 * Read `member.clinicId` for tenant scoping. A `clinicId` must never arrive in
 * a request body — that is the difference between multi-tenant and
 * multi-tenant-shaped.
 */
export const CurrentMember = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ClinicMemberContext =>
    requireMember(contextOf(context)),
);
