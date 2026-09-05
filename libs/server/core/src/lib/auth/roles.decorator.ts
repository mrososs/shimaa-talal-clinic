import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@clinic/contracts';

export const ROLES_KEY = 'auth:roles';

/**
 * Declares which roles may reach a route. Any one of them is enough.
 *
 * It is also what tells `RolesGuard` *what to resolve*: naming a staff role
 * causes a clinic-member lookup, naming `guardian` causes a guardian lookup,
 * and a route that names neither pays for neither.
 *
 *   `@Roles(UserRole.Guardian)`                  a parent acting for their own children
 *   `@Roles(UserRole.Reception, UserRole.Admin)` reception desk work
 *
 * This is coarse by design. It answers "may this kind of user call this
 * endpoint at all", not "may they touch this particular row" — ownership is a
 * predicate inside the query, where it cannot be forgotten.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
