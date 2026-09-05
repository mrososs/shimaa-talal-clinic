import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClinicMemberStatus, UserRole } from '@clinic/contracts';
import type { AuthenticatedRequest } from './authenticated-request';
import {
  CLINIC_MEMBER_RESOLVER,
  type ClinicMemberContext,
  type ClinicMemberResolver,
} from './clinic-member-resolver';
import {
  GUARDIAN_RESOLVER,
  type GuardianContext,
  type GuardianResolver,
} from './guardian-resolver';
import { ROLES_KEY } from './roles.decorator';

/**
 * Decides what an authenticated caller may do, and resolves who they are in
 * clinic terms while doing it.
 *
 * `SupabaseAuthGuard` establishes *identity* — a verified Supabase user. That
 * user is not yet a guardian or a staff member; those are application facts,
 * held in tables this library may not read directly. So this guard asks the
 * domains through two ports, and it asks for exactly what the route declared it
 * needs: a staff route never goes looking for a guardian, and a route with no
 * `@Roles()` costs no queries at all.
 *
 * That last point is why role resolution lives in a guard rather than an
 * interceptor. Nest runs guards *before* interceptors, so an interceptor could
 * never feed a decision this guard has to make. It also keeps the cost
 * proportional: `GET /me` has to work for a user who is neither, and pays
 * nothing for the privilege.
 *
 * NOT REGISTERED GLOBALLY YET. Both resolvers are ports with no implementation
 * until the patients and clinic domains land, and registering a guard whose
 * dependencies cannot resolve would fail at boot. Registration is one entry in
 * `apps/api`'s providers, alongside the two bindings.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(GUARDIAN_RESOLVER) private readonly guardians: GuardianResolver,
    @Inject(CLINIC_MEMBER_RESOLVER)
    private readonly members: ClinicMemberResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No declaration means the route is authenticated-only. That is a real
    // category, not an oversight: `/me` must answer for a signed-in user who
    // has not yet become a guardian.
    if (required === undefined || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authUser = request?.user;

    if (!authUser) {
      // Reached by combining `@Public()` with `@Roles()`, which is a mistake
      // rather than a state. 401 is the truthful answer: there is no caller.
      throw new UnauthorizedException('Authentication required.');
    }

    const wantsGuardian = required.includes(UserRole.Guardian);
    const wantsStaff = required.some((role) => role !== UserRole.Guardian);

    const guardian = wantsGuardian
      ? await this.guardians.resolveByAuthUserId(authUser.id)
      : null;
    const member = wantsStaff
      ? await this.members.resolveByAuthUserId(authUser.id)
      : null;

    if (member !== null && member.status !== ClinicMemberStatus.Active) {
      // Offboarding is a status change, not a deletion, so this is the normal
      // path for a former member. Saying so plainly beats a blank 403 — the
      // caller is already authenticated as this account, so nothing leaks.
      throw new ForbiddenException('This clinic account is suspended.');
    }

    const held = rolesHeld(guardian, member);

    if (!held.some((role) => required.includes(role))) {
      throw new ForbiddenException(
        'This account does not have access to that resource.',
      );
    }

    // A new object rather than a mutation: `CachedTokenVerifier` may hand the
    // same `AuthenticatedUser` to several requests, and writing roles onto it
    // would leak one request's resolution into another's.
    request.user = { ...authUser, roles: held };
    request.context = {
      authUser: request.user,
      guardian,
      member,
      clinicId: member?.clinicId ?? guardian?.clinicId ?? null,
    };

    return true;
  }
}

function rolesHeld(
  guardian: GuardianContext | null,
  member: ClinicMemberContext | null,
): UserRole[] {
  const roles: UserRole[] = [];
  if (guardian !== null) {
    roles.push(UserRole.Guardian);
  }
  // Staff status was already checked; an inactive member never reaches here.
  if (member !== null) {
    roles.push(member.role);
  }
  return roles;
}
