import {
  UnauthorizedException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request';
import type { AuthenticatedUser } from './authenticated-user';

/**
 * The check, as a plain function — see `current-context.decorator.ts` for why
 * it is not inlined into the decorator.
 */
export function requireUser(
  user: AuthenticatedUser | undefined,
): AuthenticatedUser {
  if (!user) {
    throw new UnauthorizedException('Authentication required.');
  }
  return user;
}

/**
 * Injects the verified caller into a handler parameter.
 *
 * Non-nullable by design: on any route the global guard protects, a handler
 * cannot run without a user, so callers should not have to null-check one.
 *
 * The only way to reach the throw is to combine `@Public()` with
 * `@CurrentUser()` on the same route, which is a mistake rather than a state.
 * It raises 401 rather than 500 because that is the truthful answer — there is
 * no authenticated user — and it fails the request instead of the process.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    requireUser(
      context.switchToHttp().getRequest<AuthenticatedRequest>()?.user,
    ),
);
