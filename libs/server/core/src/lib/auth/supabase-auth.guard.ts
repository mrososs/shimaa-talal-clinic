import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './authenticated-request';
import { IS_PUBLIC_ROUTE } from './public.decorator';
import { TOKEN_VERIFIER, type TokenVerifier } from './token-verifier';

/**
 * Turns "a bearer token arrived" into "we know who this is", and refuses the
 * request when it cannot.
 *
 * Registered as `APP_GUARD` in `apps/api`, not here: a global guard provided
 * from a library module would be registered once per import of that module, and
 * `ServerCoreModule` is imported by every domain. Registering it at the
 * composition root also keeps the decision about what is protected in the one
 * place that composes the application.
 *
 * The guard resolves *identity* only — who is calling. What they may do is
 * authorisation, and it belongs to a separate layer that reads clinic
 * membership and guardian ownership.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly tokenVerifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }

    // The API is HTTP-only. If a non-HTTP transport is ever added, it arrives
    // unprotected by default rather than silently trusted, and whoever adds it
    // has to make an explicit decision here.
    if (context.getType() !== 'http') {
      throw new UnauthorizedException('Authentication required.');
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request);

    if (token === null) {
      throw new UnauthorizedException('Authentication required.');
    }

    const user = await this.tokenVerifier.verify(token);

    if (user === null) {
      // Deliberately does not distinguish expired from forged from revoked.
      // The client's response to all three is identical — refresh once, then
      // sign out — and the difference is only useful to someone probing.
      throw new UnauthorizedException(
        'The access token is invalid or has expired.',
      );
    }

    request.user = user;
    return true;
  }

  /**
   * Handler metadata wins over controller metadata, so a controller can be
   * protected as a whole while one route on it opts out.
   */
  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}

/**
 * `Authorization: Bearer <token>`, per RFC 6750.
 *
 * Returns `null` for anything it cannot read with confidence rather than
 * guessing: an absent header, a duplicated one (which Node surfaces as an
 * array and which no legitimate client sends), a different scheme, or an empty
 * token. The scheme is matched case-insensitively because RFC 7235 defines it
 * that way, and some clients send `bearer`.
 */
function extractBearerToken(request: AuthenticatedRequest): string | null {
  const header = request?.headers?.['authorization'];

  if (typeof header !== 'string') {
    return null;
  }

  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
