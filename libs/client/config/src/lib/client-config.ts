/// <reference types="vite/client" />

/**
 * The one place a frontend reads its environment.
 *
 * Vue components, composables and the API client never touch `import.meta.env`
 * directly — they receive a `ClientConfig`. That keeps environment access
 * auditable, which matters because the frontend must never be handed a
 * server-only secret (see `assertNoServerSecrets`).
 */

export type AppEnvironment = 'development' | 'staging' | 'production';

export interface ClientConfig {
  /** Absolute base URL of the NestJS API, including `/api/v1`. */
  apiUrl: string;
  /**
   * Supabase project URL. `null` when unconfigured, so an app can still boot
   * locally before Supabase is set up.
   */
  supabaseUrl: string | null;
  /**
   * Supabase **publishable key** (`sb_publishable_...`).
   *
   * Safe to ship in a client bundle: it is constrained by Row Level Security.
   * This is the only Supabase key a frontend may ever hold — never a
   * `sb_secret_...` key. See `assertNoServerSecrets`.
   */
  supabasePublishableKey: string | null;
  environment: AppEnvironment;
}

/** The shape of `import.meta.env` — kept structural so this stays testable. */
export type RawClientEnv = Record<string, unknown>;

const DEFAULT_API_URL = 'http://localhost:3000/api/v1';

/**
 * Names that must never reach a browser bundle. Includes the legacy
 * `service_role` spelling: this project uses the current Supabase key model,
 * but an old deployment or a copied snippet may still use the old name.
 */
const SERVER_ONLY_ENV_KEYS = [
  'VITE_SUPABASE_SECRET_KEY',
  'VITE_SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_JWT_SECRET',
  'VITE_DATABASE_URL',
];

/**
 * Value shapes that are secret regardless of what the variable was called.
 *
 * A name-based blocklist only catches the mistakes we anticipated;
 * `VITE_MY_KEY=sb_secret_...` would sail straight through it. Checking the
 * value closes that gap.
 */
const SERVER_ONLY_VALUE_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly describe: string;
}> = [
  { pattern: /^sb_secret_/i, describe: 'a Supabase secret key' },
  {
    pattern: /^postgres(ql)?:\/\//i,
    describe: 'a PostgreSQL connection string',
  },
  // Legacy service_role JWTs are unprefixed, but their payload names the role.
  {
    pattern: /^eyJ[\w-]*\.[\w-]*service_role/,
    describe: 'a legacy service_role key',
  },
];

export class ClientConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientConfigError';
  }
}

/**
 * Fails the app rather than let a server-only secret ship to a browser.
 *
 * Vite only exposes variables prefixed with `VITE_`, so the guard checks for
 * secrets that were given that prefix by mistake.
 */
export function assertNoServerSecrets(env: RawClientEnv): void {
  const leaked: string[] = [];

  for (const [key, rawValue] of Object.entries(env)) {
    if (typeof rawValue !== 'string' || rawValue.trim() === '') {
      continue;
    }

    if (SERVER_ONLY_ENV_KEYS.includes(key)) {
      leaked.push(`${key} (server-only variable)`);
      continue;
    }

    // Vite only inlines VITE_-prefixed variables, so only those can leak.
    if (!key.startsWith('VITE_')) {
      continue;
    }

    const value = rawValue.trim();
    const match = SERVER_ONLY_VALUE_PATTERNS.find(({ pattern }) =>
      pattern.test(value),
    );

    if (match) {
      leaked.push(`${key} (looks like ${match.describe})`);
    }
  }

  if (leaked.length > 0) {
    // The value itself is never included in the message: it would then be in
    // the browser console, which is exactly what we are preventing.
    throw new ClientConfigError(
      `Server-only secrets were exposed to the client bundle: ${leaked.join(
        ', ',
      )}. These values belong to the API only — remove them from any VITE_ ` +
        'variable. See docs/local-development.md.',
    );
  }
}

function readString(env: RawClientEnv, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function readEnvironment(env: RawClientEnv): AppEnvironment {
  const value = readString(env, 'VITE_APP_ENV');
  return value === 'production' ||
    value === 'staging' ||
    value === 'development'
    ? value
    : 'development';
}

/**
 * Pure reader — pass any env-like object. Used by `getClientConfig` and by
 * tests.
 */
export function readClientConfig(env: RawClientEnv): ClientConfig {
  assertNoServerSecrets(env);

  return {
    apiUrl: readString(env, 'VITE_API_URL') ?? DEFAULT_API_URL,
    supabaseUrl: readString(env, 'VITE_SUPABASE_URL'),
    supabasePublishableKey: readString(env, 'VITE_SUPABASE_PUBLISHABLE_KEY'),
    environment: readEnvironment(env),
  };
}

let cached: ClientConfig | null = null;

/** Reads (once) the config of the running Vite app. */
export function getClientConfig(): ClientConfig {
  cached ??= readClientConfig(import.meta.env as unknown as RawClientEnv);
  return cached;
}

/** Test seam — drops the memoised config. */
export function resetClientConfig(): void {
  cached = null;
}

export interface SupabaseClientConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

/**
 * Narrows a `ClientConfig` to one where Supabase is actually configured, so
 * callers get a compile-time guarantee instead of runtime `null` checks.
 */
export function isSupabaseConfigured(
  config: ClientConfig,
): config is ClientConfig & SupabaseClientConfig {
  return config.supabaseUrl !== null && config.supabasePublishableKey !== null;
}
