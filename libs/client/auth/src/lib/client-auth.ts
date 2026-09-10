import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The frontend's session boundary.
 *
 * Supabase Auth is used *directly* by the clients for login and session
 * management — that is the one thing frontends are allowed to do against
 * Supabase. Everything else (booking, queue, payments) goes through the NestJS
 * API, which is why this library only exposes a session/token surface and no
 * data access whatsoever.
 *
 * Framework-free on purpose: the mobile app and the dashboard both consume it,
 * and a Vue composable or store belongs a layer above this one.
 */

export interface AuthSession {
  accessToken: string;
  userId: string;
  /** Verified phone attached to this Supabase identity, in E.164 form. */
  phone: string | null;
  /** Unix seconds, or `null` when the provider does not report one. */
  expiresAt: number | null;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface PhoneOtpCredentials {
  /** E.164. Formatting and regional validation belongs to the caller. */
  phone: string;
  token: string;
}

/**
 * Why an auth call failed, in terms a UI can act on.
 *
 * Supabase's own message strings are English, subject to change, and not fit to
 * show a parent. Mapping them once, here, is what lets a screen render its own
 * wording — Arabic, in this product — without string-matching an SDK.
 */
export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'email_taken'
  /**
   * The address itself was refused — a typo, or a domain the project blocks.
   *
   * Worth its own code rather than falling through to `unknown`: the person can
   * fix a typo the moment they are told which field is wrong, and "an
   * unexpected error occurred" tells them to try the same thing again.
   */
  | 'email_invalid'
  | 'phone_invalid'
  | 'weak_password'
  | 'otp_invalid'
  | 'otp_expired'
  | 'otp_delivery_failed'
  | 'rate_limited'
  /** The request never got an answer. Says nothing about the credentials. */
  | 'network'
  | 'unknown';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    cause?: unknown,
  ) {
    // `cause` goes through the standard Error options bag rather than a field
    // of our own: Error already owns that name, and shadowing it would leave
    // two properties that can disagree.
    super(message, { cause });
    this.name = 'AuthError';
  }
}

export interface SignUpResult {
  /**
   * `null` when the project requires email confirmation — the account exists
   * but cannot act yet. Callers must not route to a signed-in screen on `null`.
   */
  session: AuthSession | null;
  needsEmailConfirmation: boolean;
}

export interface AuthProvider {
  getSession(): Promise<AuthSession | null>;
  /** Convenience for `ApiClient.getAccessToken`. */
  getAccessToken(): Promise<string | null>;
  /**
   * Resolve the persisted session at app start and confirm the server still
   * accepts it. Returns `null` when there is no usable session.
   */
  restoreSession(): Promise<AuthSession | null>;
  signInWithPassword(credentials: AuthCredentials): Promise<AuthSession>;
  signUp(credentials: AuthCredentials): Promise<SignUpResult>;
  /** Send an SMS challenge. A successful start does not create a session. */
  startPhoneOtp(phone: string): Promise<void>;
  /** Verify the SMS challenge and return the session it establishes. */
  verifyPhoneOtp(credentials: PhoneOtpCredentials): Promise<AuthSession>;
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  /** Returns an unsubscribe function. */
  onAuthStateChange(
    listener: (session: AuthSession | null) => void,
  ): () => void;
  signOut(): Promise<void>;
}

export interface SupabaseAuthProviderOptions {
  supabaseUrl: string;
  /** The *publishable* (anon) key. Never a service-role key. */
  publishableKey: string;
}

/** The session object supabase-js returns, narrowed to the parts we use. */
interface RawSession {
  access_token: string;
  expires_at?: number;
  user: { id: string; phone?: string | null };
}

export function createSupabaseAuthProvider(
  options: SupabaseAuthProviderOptions,
): AuthProvider {
  const client: SupabaseClient = createClient(
    options.supabaseUrl,
    options.publishableKey,
    { auth: { persistSession: true, autoRefreshToken: true } },
  );

  const toSession = (raw: RawSession | null): AuthSession | null =>
    raw
      ? {
          accessToken: raw.access_token,
          userId: raw.user.id,
          phone: raw.user.phone?.trim() || null,
          expiresAt: raw.expires_at ?? null,
        }
      : null;

  return {
    async getSession() {
      const { data } = await client.auth.getSession();
      return toSession(data.session);
    },

    async getAccessToken() {
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    },

    async restoreSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw toAuthError(error);

      const session = toSession(data.session);
      if (session === null) return null;

      // A stored session can outlive the account behind it — deleted, banned,
      // or signed out elsewhere. Asking the server once at boot is what stops
      // the app rendering a signed-in screen and then 401-ing on its first
      // real request.
      const { error: verifyError } = await client.auth.getUser();
      if (!verifyError) return session;

      // A transport failure says nothing about whether the session is valid.
      // Discarding it here would sign people out whenever they opened the app
      // on a poor connection, which is most of the point of persisting it.
      if (toAuthError(verifyError).code === 'network') return session;

      // The server actively rejected it. Clear it locally: a global sign-out
      // would post a token the server has already refused.
      await client.auth.signOut({ scope: 'local' });
      return null;
    },

    async signInWithPassword(credentials) {
      const { data, error } = await client.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      });
      if (error) throw toAuthError(error);

      const session = toSession(data.session);
      if (session === null) {
        // Projects that require email confirmation accept the credentials but
        // issue no session. That is a failure from the caller's point of view.
        throw new AuthError(
          'email_not_confirmed',
          'Signed in, but no session was issued.',
        );
      }
      return session;
    },

    async signUp(credentials) {
      const { data, error } = await client.auth.signUp({
        email: credentials.email,
        password: credentials.password,
      });
      if (error) throw toAuthError(error);

      // No session means the project requires email confirmation. Supabase
      // also answers this way for an address that already exists, deliberately,
      // so that signup cannot be used to enumerate accounts — so a caller must
      // word this as "check your email" rather than "account created".
      const session = toSession(data.session);
      return { session, needsEmailConfirmation: session === null };
    },

    async startPhoneOtp(phone) {
      const { error } = await client.auth.signInWithOtp({ phone });
      if (error) throw toAuthError(error);
    },

    async verifyPhoneOtp(credentials) {
      const { data, error } = await client.auth.verifyOtp({
        phone: credentials.phone,
        token: credentials.token,
        type: 'sms',
      });
      if (error) throw toAuthError(error);

      const session = toSession(data.session);
      if (session === null) {
        throw new AuthError(
          'otp_invalid',
          'The one-time code did not establish a session.',
        );
      }
      return session;
    },

    async requestPasswordReset(email, redirectTo) {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (error) throw toAuthError(error);
    },

    async updatePassword(password) {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw toAuthError(error);
    },

    onAuthStateChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        listener(toSession(session));
      });
      return () => data.subscription.unsubscribe();
    },

    async signOut() {
      await client.auth.signOut();
    },
  };
}

/**
 * Map a Supabase auth failure onto our own vocabulary.
 *
 * Reads `code` first, because that is the field Supabase intends for this and
 * it survives wording changes; falls back to `status`, and only then to
 * matching the message, which is a last resort and treated as one.
 */
function toAuthError(error: unknown): AuthError {
  const { code, status, message } = readError(error);
  const text = message.toLowerCase();

  if (
    code === 'invalid_credentials' ||
    text.includes('invalid login credentials')
  ) {
    return new AuthError('invalid_credentials', message, error);
  }
  if (code === 'email_not_confirmed' || text.includes('email not confirmed')) {
    return new AuthError('email_not_confirmed', message, error);
  }
  if (
    code === 'user_already_exists' ||
    text.includes('already registered') ||
    text.includes('already been registered')
  ) {
    return new AuthError('email_taken', message, error);
  }
  if (
    code === 'email_address_invalid' ||
    code === 'email_address_not_authorized' ||
    (text.includes('email') && text.includes('is invalid'))
  ) {
    return new AuthError('email_invalid', message, error);
  }
  if (
    code === 'phone_provider_disabled' ||
    code === 'sms_send_failed' ||
    text.includes('error sending confirmation otp') ||
    text.includes('phone provider is not enabled')
  ) {
    return new AuthError('otp_delivery_failed', message, error);
  }
  if (
    code === 'phone_address_invalid' ||
    (code === 'validation_failed' && text.includes('phone')) ||
    text.includes('invalid phone')
  ) {
    return new AuthError('phone_invalid', message, error);
  }
  if (code === 'otp_expired' || text.includes('token has expired')) {
    return new AuthError('otp_expired', message, error);
  }
  if (
    code === 'otp_invalid' ||
    text.includes('token is invalid') ||
    text.includes('invalid otp')
  ) {
    return new AuthError('otp_invalid', message, error);
  }
  if (
    code === 'weak_password' ||
    text.includes('password should be at least')
  ) {
    return new AuthError('weak_password', message, error);
  }
  if (
    code === 'over_request_rate_limit' ||
    code === 'over_sms_send_rate_limit' ||
    status === 429
  ) {
    return new AuthError('rate_limited', message, error);
  }
  // supabase-js reports a fetch failure with no usable HTTP status. Telling
  // that apart matters: restoreSession keeps a session on a network error and
  // discards it on a rejection.
  if (
    status === undefined ||
    status === 0 ||
    text.includes('failed to fetch')
  ) {
    return new AuthError('network', message, error);
  }
  return new AuthError('unknown', message, error);
}

function readError(error: unknown): {
  code?: string;
  status?: number;
  message: string;
} {
  if (typeof error !== 'object' || error === null) {
    return { message: String(error) };
  }
  const source = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };
  return {
    code: typeof source.code === 'string' ? source.code : undefined,
    status: typeof source.status === 'number' ? source.status : undefined,
    message:
      typeof source.message === 'string'
        ? source.message
        : 'Authentication failed.',
  };
}
