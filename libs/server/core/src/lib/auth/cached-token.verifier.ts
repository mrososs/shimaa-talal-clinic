import { createHash } from 'node:crypto';
import type { AuthenticatedUser } from './authenticated-user';
import type { TokenVerifier } from './token-verifier';

/**
 * How long a successful verification may be reused.
 *
 * Short on purpose. This is a latency cache, not a session store: the longer it
 * lives, the longer a revoked token keeps working. Thirty seconds removes
 * essentially all of the repeated cost — a dashboard polling the queue every
 * five seconds verifies twice a minute instead of twelve times — while keeping
 * the window in which a signed-out user is still admitted down to something a
 * person would not notice.
 */
export const TOKEN_CACHE_TTL_MS = 30_000;

/**
 * Ceiling on retained entries, so a burst of distinct tokens cannot grow the
 * process's memory without bound.
 */
export const TOKEN_CACHE_MAX_ENTRIES = 5_000;

interface CacheEntry {
  user: AuthenticatedUser;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/**
 * Wraps a `TokenVerifier` so the same token is not re-verified on every request.
 *
 * `SupabaseTokenVerifier` makes one HTTP round-trip to Supabase Auth per call.
 * That is a per-request dependency on a third party for latency *and*
 * availability, and it multiplies: three receptionists polling the queue board
 * every five seconds is thirty-six verifications a minute, all of the same
 * handful of tokens.
 *
 * Two rules keep this from turning a performance fix into a security hole:
 *
 *   1. **Failures are never cached.** A rejection can come from a transient
 *      Supabase outage as easily as from a bad token, and caching that would
 *      lock a legitimate user out for the whole TTL.
 *   2. **An entry never outlives its token.** The cache window is capped at the
 *      token's own `exp`, so a cached identity can never be served after the
 *      moment the token itself stopped being valid.
 *
 * Concurrent first-time requests with the same token will each reach the inner
 * verifier — there is no in-flight de-duplication. That costs a few extra calls
 * on a cold cache and keeps this class simple; add it only if measurements ever
 * justify it.
 */
export class CachedTokenVerifier implements TokenVerifier {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly inner: TokenVerifier,
    private readonly ttlMs: number = TOKEN_CACHE_TTL_MS,
    private readonly maxEntries: number = TOKEN_CACHE_MAX_ENTRIES,
  ) {}

  /** Current retained entries. Exposed for tests and future health reporting. */
  get size(): number {
    return this.entries.size;
  }

  async verify(accessToken: string): Promise<AuthenticatedUser | null> {
    if (!accessToken) {
      return null;
    }

    const key = fingerprint(accessToken);
    const now = Date.now();
    const cached = this.entries.get(key);

    if (cached !== undefined) {
      if (cached.expiresAt > now) {
        return cached.user;
      }
      this.entries.delete(key);
    }

    const user = await this.inner.verify(accessToken);

    if (user === null) {
      return null;
    }

    this.store(key, user, accessToken, now);
    return user;
  }

  private store(
    key: string,
    user: AuthenticatedUser,
    accessToken: string,
    now: number,
  ): void {
    const tokenExpiresAt = readTokenExpiry(accessToken);
    const ttlExpiresAt = now + this.ttlMs;
    const expiresAt =
      tokenExpiresAt === null
        ? ttlExpiresAt
        : Math.min(ttlExpiresAt, tokenExpiresAt);

    // A token already at or past its expiry has nothing worth remembering.
    if (expiresAt <= now) {
      return;
    }

    if (this.entries.size >= this.maxEntries) {
      this.evict(now);
    }

    this.entries.set(key, { user, expiresAt });
  }

  /**
   * Drop everything stale, and if that was not enough, the oldest entries.
   *
   * Amortised: it runs only when the ceiling is reached, so the common path
   * stays a single map lookup.
   */
  private evict(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }

    // Map iterates in insertion order, so the front is the least recently added.
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.entries.delete(oldest.value);
    }
  }
}

/**
 * Key by digest rather than by the token itself, so a heap dump does not hand
 * over a set of live, replayable credentials.
 */
function fingerprint(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex');
}

/**
 * Read `exp` out of a JWT payload, in epoch milliseconds.
 *
 * The payload is decoded, not verified — that already happened, in the inner
 * verifier, which is the only reason this call is being cached at all. The
 * value is used **solely to shorten** the cache window; it can never extend it
 * and is never an input to an authorisation decision. A token this cannot parse
 * simply falls back to the TTL.
 */
function readTokenExpiry(accessToken: string): number | null {
  const segments = accessToken.split('.');
  if (segments.length !== 3) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(
      Buffer.from(segments[1], 'base64url').toString('utf8'),
    );

    if (typeof payload !== 'object' || payload === null) {
      return null;
    }

    const exp = (payload as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}
