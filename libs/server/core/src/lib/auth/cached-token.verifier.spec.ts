import {
  CachedTokenVerifier,
  TOKEN_CACHE_TTL_MS,
} from './cached-token.verifier';
import type { AuthenticatedUser } from './authenticated-user';

/**
 * A cache in front of authentication is a security control as much as a
 * performance one, so most of what is asserted here is about *not* serving
 * something it should have forgotten.
 */

const USER: AuthenticatedUser = {
  id: 'auth-user-1',
  email: 'parent@example.test',
  roles: [],
};

const OTHER_USER: AuthenticatedUser = {
  id: 'auth-user-2',
  email: 'reception@example.test',
  roles: [],
};

const START = Date.UTC(2026, 8, 5, 12, 0, 0);

/** A JWT-shaped token whose payload carries `exp`, in epoch seconds. */
function tokenExpiringAt(epochMs: number, salt = 'a'): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: 'auth-user-1', exp: Math.floor(epochMs / 1000) }),
  ).toString('base64url');
  return `header.${payload}.signature-${salt}`;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(START);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('CachedTokenVerifier', () => {
  describe('reuse', () => {
    it('verifies once for repeated calls inside the TTL', async () => {
      const inner = jest.fn().mockResolvedValue(USER);
      const verifier = new CachedTokenVerifier({ verify: inner });

      await expect(verifier.verify('opaque-token')).resolves.toEqual(USER);
      jest.setSystemTime(START + TOKEN_CACHE_TTL_MS - 1);
      await expect(verifier.verify('opaque-token')).resolves.toEqual(USER);

      expect(inner).toHaveBeenCalledTimes(1);
    });

    it('verifies again once the TTL has elapsed', async () => {
      const inner = jest.fn().mockResolvedValue(USER);
      const verifier = new CachedTokenVerifier({ verify: inner });

      await verifier.verify('opaque-token');
      jest.setSystemTime(START + TOKEN_CACHE_TTL_MS);
      await verifier.verify('opaque-token');

      expect(inner).toHaveBeenCalledTimes(2);
    });

    it('keeps different tokens apart', async () => {
      const inner = jest
        .fn()
        .mockResolvedValueOnce(USER)
        .mockResolvedValueOnce(OTHER_USER);
      const verifier = new CachedTokenVerifier({ verify: inner });

      await expect(verifier.verify('token-a')).resolves.toEqual(USER);
      await expect(verifier.verify('token-b')).resolves.toEqual(OTHER_USER);
      // And each is now served from its own entry.
      await expect(verifier.verify('token-a')).resolves.toEqual(USER);
      await expect(verifier.verify('token-b')).resolves.toEqual(OTHER_USER);

      expect(inner).toHaveBeenCalledTimes(2);
    });

    it('passes the token through unchanged', async () => {
      const inner = jest.fn().mockResolvedValue(USER);
      const verifier = new CachedTokenVerifier({ verify: inner });

      await verifier.verify('opaque-token');

      expect(inner).toHaveBeenCalledWith('opaque-token');
    });
  });

  describe('refuses to cache', () => {
    it('a rejection', async () => {
      // A rejection can come from a Supabase outage as easily as a bad token.
      // Caching it would lock a legitimate user out for the whole TTL.
      const inner = jest.fn().mockResolvedValue(null);
      const verifier = new CachedTokenVerifier({ verify: inner });

      await expect(verifier.verify('bad-token')).resolves.toBeNull();
      await expect(verifier.verify('bad-token')).resolves.toBeNull();

      expect(inner).toHaveBeenCalledTimes(2);
      expect(verifier.size).toBe(0);
    });

    it('and lets a token start working as soon as it does', async () => {
      const inner = jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(USER);
      const verifier = new CachedTokenVerifier({ verify: inner });

      await expect(verifier.verify('token')).resolves.toBeNull();
      await expect(verifier.verify('token')).resolves.toEqual(USER);
    });

    it('an empty token, without consulting the inner verifier', async () => {
      const inner = jest.fn();
      const verifier = new CachedTokenVerifier({ verify: inner });

      await expect(verifier.verify('')).resolves.toBeNull();
      expect(inner).not.toHaveBeenCalled();
    });

    it('an error from the inner verifier', async () => {
      const inner = jest.fn().mockRejectedValue(new Error('supabase down'));
      const verifier = new CachedTokenVerifier({ verify: inner });

      await expect(verifier.verify('token')).rejects.toThrow('supabase down');
      expect(verifier.size).toBe(0);
    });
  });

  describe('never outlives the token', () => {
    it('caps the entry at the token expiry when that is sooner than the TTL', async () => {
      // Five seconds of life left, but a thirty-second TTL. Without the cap the
      // cache would keep admitting this token for twenty-five seconds after it
      // stopped being valid.
      const token = tokenExpiringAt(START + 5_000);
      const inner = jest.fn().mockResolvedValue(USER);
      const verifier = new CachedTokenVerifier({ verify: inner });

      await verifier.verify(token);
      jest.setSystemTime(START + 4_999);
      await verifier.verify(token);
      expect(inner).toHaveBeenCalledTimes(1);

      jest.setSystemTime(START + 5_000);
      await verifier.verify(token);
      expect(inner).toHaveBeenCalledTimes(2);
    });

    it('still applies the TTL when the token outlives it', async () => {
      const token = tokenExpiringAt(START + 3_600_000);
      const inner = jest.fn().mockResolvedValue(USER);
      const verifier = new CachedTokenVerifier({ verify: inner });

      await verifier.verify(token);
      jest.setSystemTime(START + TOKEN_CACHE_TTL_MS);
      await verifier.verify(token);

      expect(inner).toHaveBeenCalledTimes(2);
    });

    it('does not cache an already-expired token the inner verifier accepted', async () => {
      const token = tokenExpiringAt(START - 1_000);
      const inner = jest.fn().mockResolvedValue(USER);
      const verifier = new CachedTokenVerifier({ verify: inner });

      await verifier.verify(token);

      expect(verifier.size).toBe(0);
    });

    it.each([
      ['an opaque token', 'not-a-jwt'],
      ['a malformed payload', 'header.!!!not-base64-json!!!.signature'],
      [
        'a payload with no exp',
        `header.${Buffer.from('{"sub":"x"}').toString('base64url')}.sig`,
      ],
      [
        'a non-numeric exp',
        `header.${Buffer.from('{"exp":"soon"}').toString('base64url')}.sig`,
      ],
    ])('falls back to the TTL for %s', async (_label, token) => {
      const inner = jest.fn().mockResolvedValue(USER);
      const verifier = new CachedTokenVerifier({ verify: inner });

      await verifier.verify(token);
      expect(verifier.size).toBe(1);

      jest.setSystemTime(START + TOKEN_CACHE_TTL_MS - 1);
      await verifier.verify(token);
      expect(inner).toHaveBeenCalledTimes(1);
    });
  });

  describe('bounded growth', () => {
    it('does not grow past the ceiling', async () => {
      const inner = jest.fn().mockResolvedValue(USER);
      const verifier = new CachedTokenVerifier({ verify: inner }, 30_000, 10);

      for (let i = 0; i < 50; i += 1) {
        await verifier.verify(`token-${i}`);
      }

      expect(verifier.size).toBeLessThanOrEqual(10);
    });

    it('reclaims expired entries before evicting live ones', async () => {
      const inner = jest.fn().mockResolvedValue(USER);
      const verifier = new CachedTokenVerifier({ verify: inner }, 30_000, 10);

      for (let i = 0; i < 9; i += 1) {
        await verifier.verify(`stale-${i}`);
      }

      // Everything above is now expired; the next store should sweep rather
      // than evict, so the fresh entry survives.
      jest.setSystemTime(START + 60_000);
      await verifier.verify('fresh-a');
      await verifier.verify('fresh-b');

      expect(verifier.size).toBe(2);

      inner.mockClear();
      await verifier.verify('fresh-a');
      expect(inner).not.toHaveBeenCalled();
    });
  });

  it('keys by digest, not by the token itself', async () => {
    // A heap dump of this map must not yield a set of replayable credentials.
    const inner = jest.fn().mockResolvedValue(USER);
    const verifier = new CachedTokenVerifier({ verify: inner });

    await verifier.verify('super-secret-token');

    const serialised = JSON.stringify([
      ...(
        verifier as unknown as { entries: Map<string, unknown> }
      ).entries.keys(),
    ]);
    expect(serialised).not.toContain('super-secret-token');
    expect(serialised).toMatch(/[0-9a-f]{64}/);
  });
});
