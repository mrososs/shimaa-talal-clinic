import type { AuthenticatedUser } from './authenticated-user';
import type { RequestContext } from './request-context';

/**
 * Structural subset of the HTTP request the auth layer needs.
 *
 * Typed this way, rather than as an Express `Request`, so `server-core` keeps
 * no hard dependency on an HTTP driver's typings — the same reason
 * `ApiExceptionFilter` declares its own `JsonResponse`.
 *
 * Node lowercases incoming header names, so `authorization` is the only casing
 * that ever appears.
 */
export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  /** Set by `SupabaseAuthGuard` once a token has been verified. */
  user?: AuthenticatedUser;
  /** Set by `RolesGuard` on routes that declare `@Roles()`. */
  context?: RequestContext;
}
