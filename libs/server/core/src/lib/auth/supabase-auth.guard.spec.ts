import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './authenticated-request';
import type { AuthenticatedUser } from './authenticated-user';
import { IS_PUBLIC_ROUTE } from './public.decorator';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import type { TokenVerifier } from './token-verifier';

/**
 * The guard is the only thing standing between an anonymous request and every
 * endpoint in the platform, so these tests care about one question above all:
 * does anything reach a handler without a verified token?
 */

const USER: AuthenticatedUser = {
  id: 'auth-user-1',
  email: 'parent@example.test',
  roles: [],
};

/**
 * A minimal ExecutionContext. Whether the route is public is decided by the
 * mocked Reflector in `guardWith`, not here, so this only has to carry the
 * request, the transport type, and stable handler/class identities.
 */
function contextFor(
  request: Partial<AuthenticatedRequest> | undefined,
  options: { type?: string } = {},
): { context: ExecutionContext } {
  const handler = () => undefined;
  const controller = class {};

  const context = {
    getType: () => options.type ?? 'http',
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context };
}

function guardWith(
  verify: TokenVerifier['verify'],
  isPublic = false,
): SupabaseAuthGuard {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockReturnValue(isPublic ? true : undefined);
  return new SupabaseAuthGuard(reflector, { verify });
}

describe('SupabaseAuthGuard', () => {
  describe('rejects', () => {
    it.each([
      ['no headers at all', {}],
      ['no authorization header', { headers: {} }],
      ['an empty authorization header', { headers: { authorization: '' } }],
      [
        'a bare token with no scheme',
        { headers: { authorization: 'jwt-token' } },
      ],
      [
        'the wrong scheme',
        { headers: { authorization: 'Basic dXNlcjpwdw==' } },
      ],
      ['Bearer with no token', { headers: { authorization: 'Bearer' } }],
      [
        'Bearer with only whitespace',
        { headers: { authorization: 'Bearer   ' } },
      ],
      [
        // Node surfaces a duplicated header as an array. No legitimate client
        // sends two, and picking one would be a guess.
        'a duplicated authorization header',
        { headers: { authorization: ['Bearer a', 'Bearer b'] } },
      ],
    ])('%s', async (_label, request) => {
      const verify = jest.fn();
      const guard = guardWith(verify);

      await expect(
        guard.canActivate(contextFor(request as AuthenticatedRequest).context),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // A malformed header must never reach the verifier.
      expect(verify).not.toHaveBeenCalled();
    });

    it('a token the verifier does not recognise', async () => {
      const verify = jest.fn().mockResolvedValue(null);
      const guard = guardWith(verify);
      const request = { headers: { authorization: 'Bearer expired-token' } };

      await expect(
        guard.canActivate(contextFor(request).context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(verify).toHaveBeenCalledWith('expired-token');
      expect(request).not.toHaveProperty('user');
    });

    it('a non-HTTP transport, rather than trusting it by default', async () => {
      const verify = jest.fn();
      const guard = guardWith(verify);

      await expect(
        guard.canActivate(contextFor({ headers: {} }, { type: 'rpc' }).context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(verify).not.toHaveBeenCalled();
    });

    it('without revealing why a token failed', async () => {
      // Expired, forged and revoked must be indistinguishable to the caller.
      const guard = guardWith(jest.fn().mockResolvedValue(null));

      await expect(
        guard.canActivate(
          contextFor({ headers: { authorization: 'Bearer nope' } }).context,
        ),
      ).rejects.toThrow('The access token is invalid or has expired.');
    });
  });

  describe('admits', () => {
    it('a verified token, attaching the user to the request', async () => {
      const verify = jest.fn().mockResolvedValue(USER);
      const guard = guardWith(verify);
      const request: AuthenticatedRequest = {
        headers: { authorization: 'Bearer good-token' },
      };

      await expect(
        guard.canActivate(contextFor(request).context),
      ).resolves.toBe(true);
      expect(verify).toHaveBeenCalledWith('good-token');
      expect(request.user).toEqual(USER);
    });

    it.each([
      ['lowercase scheme', 'bearer good-token'],
      ['mixed-case scheme', 'BeArEr good-token'],
      ['extra internal whitespace', 'Bearer    good-token'],
      ['surrounding whitespace', '  Bearer good-token  '],
    ])('%s', async (_label, authorization) => {
      const verify = jest.fn().mockResolvedValue(USER);
      const guard = guardWith(verify);

      await expect(
        guard.canActivate(contextFor({ headers: { authorization } }).context),
      ).resolves.toBe(true);
      expect(verify).toHaveBeenCalledWith('good-token');
    });

    it('a public route without consulting the verifier', async () => {
      const verify = jest.fn();
      const guard = guardWith(verify, true);

      await expect(
        guard.canActivate(contextFor({ headers: {} }).context),
      ).resolves.toBe(true);
      expect(verify).not.toHaveBeenCalled();
    });

    it('a public route even on a non-HTTP transport', async () => {
      // The public check runs first, so /health stays reachable regardless.
      const guard = guardWith(jest.fn(), true);

      await expect(
        guard.canActivate(contextFor(undefined, { type: 'rpc' }).context),
      ).resolves.toBe(true);
    });
  });

  it('lets a handler override a protected controller', async () => {
    // getAllAndOverride is called with [handler, class] in that order, which is
    // what makes the handler win.
    const reflector = new Reflector();
    const spy = jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(true);
    const guard = new SupabaseAuthGuard(reflector, { verify: jest.fn() });
    const { context } = contextFor({ headers: {} });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    const [key, targets] = spy.mock.calls[0];
    expect(key).toBe(IS_PUBLIC_ROUTE);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toBe(context.getHandler());
    expect(targets[1]).toBe(context.getClass());
  });

  it('treats a non-boolean metadata value as not public', async () => {
    // Only an explicit `true` opts a route out; a stray truthy value must not.
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue('yes' as unknown as boolean);
    const verify = jest.fn();
    const guard = new SupabaseAuthGuard(reflector, { verify });

    await expect(
      guard.canActivate(contextFor({ headers: {} }).context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });
});
