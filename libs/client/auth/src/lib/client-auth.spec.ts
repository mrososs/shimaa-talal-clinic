import { beforeEach, describe, expect, it, vi } from 'vitest';

const createClient = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

const { AuthError, createSupabaseAuthProvider } = await import('./client-auth');

/**
 * These tests stand in for the Supabase SDK entirely. What is worth asserting
 * is not that the SDK works, but the decisions this adapter makes on top of it:
 * which failures map to which code, and — the one with real consequences —
 * when `restoreSession` throws a stored session away.
 */

const SESSION = {
  access_token: 'jwt-token',
  expires_at: 1_800_000_000,
  user: { id: 'user-1', phone: '+201012345678' },
};

interface AuthStub {
  getSession: ReturnType<typeof vi.fn>;
  getUser: ReturnType<typeof vi.fn>;
  signInWithPassword: ReturnType<typeof vi.fn>;
  signUp: ReturnType<typeof vi.fn>;
  signInWithOtp: ReturnType<typeof vi.fn>;
  verifyOtp: ReturnType<typeof vi.fn>;
  resetPasswordForEmail: ReturnType<typeof vi.fn>;
  updateUser: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  onAuthStateChange: ReturnType<typeof vi.fn>;
}

let auth: AuthStub;
let unsubscribe: ReturnType<typeof vi.fn>;

function provider() {
  return createSupabaseAuthProvider({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_key',
  });
}

/** A Supabase-shaped error: `code` and `status` alongside the message. */
function supabaseError(
  message: string,
  extra: { code?: string; status?: number } = {},
) {
  return { name: 'AuthApiError', message, ...extra };
}

beforeEach(() => {
  unsubscribe = vi.fn();
  auth = {
    getSession: vi
      .fn()
      .mockResolvedValue({ data: { session: null }, error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signInWithOtp: vi.fn(),
    verifyOtp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    onAuthStateChange: vi
      .fn()
      .mockReturnValue({ data: { subscription: { unsubscribe } } }),
  };
  createClient.mockReset();
  createClient.mockReturnValue({ auth });
});

describe('createSupabaseAuthProvider', () => {
  it('builds one client with session persistence and refresh enabled', () => {
    provider();
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'sb_publishable_key',
      { auth: { persistSession: true, autoRefreshToken: true } },
    );
  });
});

describe('signInWithPassword', () => {
  it('returns the mapped session', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: SESSION },
      error: null,
    });

    await expect(
      provider().signInWithPassword({ email: 'a@b.com', password: 'pw' }),
    ).resolves.toEqual({
      accessToken: 'jwt-token',
      userId: 'user-1',
      phone: '+201012345678',
      expiresAt: 1_800_000_000,
    });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pw',
    });
  });

  it.each([
    [
      'code',
      supabaseError('anything', { code: 'invalid_credentials', status: 400 }),
    ],
    ['message', supabaseError('Invalid login credentials', { status: 400 })],
  ])('maps bad credentials by %s', async (_label, error) => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error,
    });

    await expect(
      provider().signInWithPassword({ email: 'a@b.com', password: 'wrong' }),
    ).rejects.toMatchObject({ name: 'AuthError', code: 'invalid_credentials' });
  });

  it('maps an unconfirmed email', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: supabaseError('Email not confirmed', { status: 400 }),
    });

    await expect(
      provider().signInWithPassword({ email: 'a@b.com', password: 'pw' }),
    ).rejects.toMatchObject({ code: 'email_not_confirmed' });
  });

  it('maps rate limiting by status', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: supabaseError('Too many requests', { status: 429 }),
    });

    await expect(
      provider().signInWithPassword({ email: 'a@b.com', password: 'pw' }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('refuses a success that carries no session', async () => {
    // Accepting this would hand the caller a signed-in state with no token.
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(
      provider().signInWithPassword({ email: 'a@b.com', password: 'pw' }),
    ).rejects.toMatchObject({ code: 'email_not_confirmed' });
  });

  it('preserves the original error as the cause', async () => {
    const error = supabaseError('Invalid login credentials', { status: 400 });
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error,
    });

    await expect(
      provider().signInWithPassword({ email: 'a@b.com', password: 'pw' }),
    ).rejects.toMatchObject({ cause: error });
  });
});

describe('signUp', () => {
  it('reports a session when the project issues one', async () => {
    auth.signUp.mockResolvedValue({ data: { session: SESSION }, error: null });

    await expect(
      provider().signUp({ email: 'a@b.com', password: 'pw' }),
    ).resolves.toEqual({
      session: {
        accessToken: 'jwt-token',
        userId: 'user-1',
        phone: '+201012345678',
        expiresAt: 1_800_000_000,
      },
      needsEmailConfirmation: false,
    });
  });

  it('reports confirmation needed when no session comes back', async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });

    await expect(
      provider().signUp({ email: 'a@b.com', password: 'pw' }),
    ).resolves.toEqual({ session: null, needsEmailConfirmation: true });
  });

  it.each([
    [
      'code',
      supabaseError('anything', { code: 'user_already_exists', status: 422 }),
    ],
    ['message', supabaseError('User already registered', { status: 422 })],
  ])('maps a taken email by %s', async (_label, error) => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error });

    await expect(
      provider().signUp({ email: 'a@b.com', password: 'pw' }),
    ).rejects.toMatchObject({ code: 'email_taken' });
  });

  it('maps a weak password', async () => {
    auth.signUp.mockResolvedValue({
      data: { session: null },
      error: supabaseError('Password should be at least 6 characters', {
        status: 422,
      }),
    });

    await expect(
      provider().signUp({ email: 'a@b.com', password: 'x' }),
    ).rejects.toMatchObject({ code: 'weak_password' });
  });
});

describe('phone OTP', () => {
  it('starts an SMS challenge without pretending a session exists', async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });

    await expect(
      provider().startPhoneOtp('+201012345678'),
    ).resolves.toBeUndefined();
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      phone: '+201012345678',
    });
  });

  it('verifies the six-digit SMS token and returns its session', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: { session: SESSION },
      error: null,
    });

    await expect(
      provider().verifyPhoneOtp({
        phone: '+201012345678',
        token: '123456',
      }),
    ).resolves.toMatchObject({
      userId: 'user-1',
      phone: '+201012345678',
    });
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      phone: '+201012345678',
      token: '123456',
      type: 'sms',
    });
  });

  it.each([
    [
      'expired',
      supabaseError('Token has expired', { code: 'otp_expired', status: 403 }),
      'otp_expired',
    ],
    [
      'invalid',
      supabaseError('Token is invalid', { status: 403 }),
      'otp_invalid',
    ],
    [
      'delivery',
      supabaseError('Error sending confirmation OTP', {
        code: 'sms_send_failed',
        status: 500,
      }),
      'otp_delivery_failed',
    ],
    [
      'rate limit',
      supabaseError('Wait before sending another', {
        code: 'over_sms_send_rate_limit',
        status: 429,
      }),
      'rate_limited',
    ],
  ])('maps an %s phone failure', async (_label, error, code) => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error });

    await expect(
      provider().verifyPhoneOtp({
        phone: '+201012345678',
        token: '000000',
      }),
    ).rejects.toMatchObject({ code });
  });

  it('refuses a successful verification response with no session', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(
      provider().verifyPhoneOtp({
        phone: '+201012345678',
        token: '123456',
      }),
    ).rejects.toMatchObject({ code: 'otp_invalid' });
  });
});

describe('password recovery', () => {
  it('requests a recovery link with the mobile callback URL', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });

    await provider().requestPasswordReset(
      'parent@example.test',
      'http://localhost:4202/auth/update-password',
    );

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'parent@example.test',
      { redirectTo: 'http://localhost:4202/auth/update-password' },
    );
  });

  it('updates the password only through an authenticated recovery session', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null });

    await provider().updatePassword('new-safe-password');

    expect(auth.updateUser).toHaveBeenCalledWith({
      password: 'new-safe-password',
    });
  });
});

describe('restoreSession', () => {
  it('returns null when nothing is stored, without asking the server', async () => {
    await expect(provider().restoreSession()).resolves.toBeNull();
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it('returns the session when the server still accepts it', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: SESSION },
      error: null,
    });
    auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    await expect(provider().restoreSession()).resolves.toEqual({
      accessToken: 'jwt-token',
      userId: 'user-1',
      phone: '+201012345678',
      expiresAt: 1_800_000_000,
    });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('discards a session the server rejects, clearing it locally', async () => {
    // The account was deleted, banned, or signed out elsewhere.
    auth.getSession.mockResolvedValue({
      data: { session: SESSION },
      error: null,
    });
    auth.getUser.mockResolvedValue({
      data: { user: null },
      error: supabaseError('Invalid JWT', { status: 401 }),
    });

    await expect(provider().restoreSession()).resolves.toBeNull();
    // Local scope: a global sign-out would post a token already refused.
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('keeps the session when verification fails on the network', async () => {
    // This is the case that matters. Signing out here would log a parent out
    // every time they opened the app on a poor connection.
    auth.getSession.mockResolvedValue({
      data: { session: SESSION },
      error: null,
    });
    auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Failed to fetch' },
    });

    await expect(provider().restoreSession()).resolves.toMatchObject({
      accessToken: 'jwt-token',
    });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('throws when the stored session cannot be read at all', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: supabaseError('Storage unavailable', { status: 500 }),
    });

    await expect(provider().restoreSession()).rejects.toBeInstanceOf(AuthError);
  });
});

describe('the surface ApiClient depends on', () => {
  it('still hands out the raw access token', async () => {
    // runtime.ts wires this straight into createApiClient({ getAccessToken }).
    // Changing its shape would silently unauthenticate every request.
    auth.getSession.mockResolvedValue({
      data: { session: SESSION },
      error: null,
    });
    await expect(provider().getAccessToken()).resolves.toBe('jwt-token');
  });

  it('reports no token rather than throwing when signed out', async () => {
    await expect(provider().getAccessToken()).resolves.toBeNull();
  });

  it('maps a session with no expiry to null', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { access_token: 't', user: { id: 'u' } } },
      error: null,
    });
    await expect(provider().getSession()).resolves.toEqual({
      accessToken: 't',
      userId: 'u',
      phone: null,
      expiresAt: null,
    });
  });
});

describe('onAuthStateChange', () => {
  it('maps each session and unsubscribes on teardown', () => {
    const listener = vi.fn();
    const stop = provider().onAuthStateChange(listener);

    const emit = auth.onAuthStateChange.mock.calls[0][0] as (
      event: string,
      session: typeof SESSION | null,
    ) => void;

    emit('SIGNED_IN', SESSION);
    expect(listener).toHaveBeenCalledWith({
      accessToken: 'jwt-token',
      userId: 'user-1',
      phone: '+201012345678',
      expiresAt: 1_800_000_000,
    });

    emit('SIGNED_OUT', null);
    expect(listener).toHaveBeenLastCalledWith(null);

    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('signOut', () => {
  it('delegates to the SDK', async () => {
    await provider().signOut();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });
});
