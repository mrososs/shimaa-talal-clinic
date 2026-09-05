/**
 * The server's environment boundary.
 *
 * This module is the ONLY place in the backend that reads `process.env`.
 * Everything else asks `ServerConfigService` for a typed value. Kept free of
 * NestJS imports so the validation logic stays unit-testable on its own.
 */

export type NodeEnvironment = 'development' | 'test' | 'production';

export interface SupabaseServerConfig {
  url: string;
  /**
   * Supabase **secret key** (`sb_secret_...`).
   *
   * This is the current Supabase key model; it replaces the legacy
   * `service_role` JWT. It bypasses Row Level Security, so it is server-side
   * only and must never reach a browser bundle.
   *
   * Scope note: with business data served by `DatabaseService` over a direct
   * PostgreSQL connection, this key is used for Supabase's own APIs — Auth
   * administration, Storage, and Realtime later — not for domain queries.
   */
  secretKey: string;
  /**
   * Supabase **publishable key** (`sb_publishable_...`), the current
   * replacement for the legacy `anon` key.
   *
   * Not a secret: it is constrained by RLS and is the same value the frontends
   * ship. The server holds it so it can build user-scoped Supabase clients
   * (`SupabaseService.forUser`) for Storage and Realtime on behalf of a
   * signed-in user.
   */
  publishableKey: string | null;
}

export interface DatabaseConfig {
  /**
   * PostgreSQL connection string for business data access.
   *
   * Separate from `SupabaseServerConfig` on purpose: `supabase-js` speaks
   * PostgREST over HTTP and cannot group independent statements into one
   * application-controlled transaction. See docs/database.md.
   */
  url: string;
  /** Maximum pooled connections held by this process. */
  poolMax: number;
  /** Milliseconds to wait for a free connection before failing. */
  connectionTimeoutMs: number;
  /**
   * Server-side cap on a single statement, so a pathological query cannot hold
   * a pooled connection open indefinitely.
   */
  statementTimeoutMs: number;
  /**
   * TLS for the database connection. Hosted Supabase requires it; a local
   * container does not offer it.
   */
  ssl: boolean;
}

/** Secrets that protect application-level credentials, not infrastructure. */
export interface SecurityConfig {
  /**
   * Server-side key for the guardian claim-code HMAC.
   *
   * A claim code is six digits — a million possibilities, which a plain digest
   * gives up in seconds to anyone holding a copy of the table. Keying the hash
   * with a secret the database does not contain means a stolen table is not
   * enough: without this value the digests cannot be reversed at all.
   *
   * Never given a VITE_ prefix, never sent to a client. Rotating it invalidates
   * every outstanding claim code, which is a few minutes of inconvenience.
   */
  claimCodePepper: string;
}

export interface ServerConfig {
  nodeEnv: NodeEnvironment;
  port: number;
  /** Allowed browser origins, or `'*'` to allow any (development only). */
  corsOrigins: string[] | '*';
  supabase: SupabaseServerConfig;
  database: DatabaseConfig;
  security: SecurityConfig;
}

export class ServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerConfigError';
  }
}

export type RawServerEnv = Record<string, string | undefined>;

const DEFAULT_PORT = 3000;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

/**
 * Environment variable names that carry a Supabase secret. Listed so the error
 * message can name the one the developer probably meant, including the legacy
 * name this project deliberately does not use.
 */
const LEGACY_SECRET_KEY_ENV = 'SUPABASE_SERVICE_ROLE_KEY';

function requireString(env: RawServerEnv, key: string, hint?: string): string {
  const value = env[key]?.trim();

  if (!value) {
    throw new ServerConfigError(
      `Missing required environment variable ${key}.` +
        (hint ? ` ${hint}` : '') +
        ' Copy .env.example to .env at the workspace root and fill it in' +
        ' (see docs/local-development.md).',
    );
  }

  return value;
}

function optionalString(env: RawServerEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function readNodeEnv(env: RawServerEnv): NodeEnvironment {
  const value = env['NODE_ENV']?.trim();
  return value === 'production' || value === 'test' ? value : 'development';
}

function readPositiveInt(
  env: RawServerEnv,
  key: string,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const raw = optionalString(env, key);

  if (raw === null) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new ServerConfigError(
      `${key} must be a positive integer, received "${raw}".`,
    );
  }

  return parsed;
}

function readPort(env: RawServerEnv): number {
  const explicit =
    optionalString(env, 'API_PORT') ?? optionalString(env, 'PORT');

  if (explicit === null) {
    return DEFAULT_PORT;
  }

  const port = Number.parseInt(explicit, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new ServerConfigError(
      `API_PORT must be a valid TCP port, received "${explicit}".`,
    );
  }

  return port;
}

function readCorsOrigins(env: RawServerEnv): string[] | '*' {
  const raw = optionalString(env, 'API_CORS_ORIGINS');

  if (raw === null || raw === '*') {
    return '*';
  }

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function readBoolean(
  env: RawServerEnv,
  key: string,
  fallback: boolean,
): boolean {
  const raw = optionalString(env, key)?.toLowerCase();

  if (raw === undefined || raw === null) {
    return fallback;
  }
  if (raw === 'true' || raw === '1') {
    return true;
  }
  if (raw === 'false' || raw === '0') {
    return false;
  }

  throw new ServerConfigError(
    `${key} must be true or false, received "${raw}".`,
  );
}

/** Minimum pepper length. A short secret is barely better than none. */
const MIN_PEPPER_LENGTH = 32;

function readSecurity(env: RawServerEnv): SecurityConfig {
  const claimCodePepper = requireString(
    env,
    'CLAIM_CODE_PEPPER',
    'Generate one with `openssl rand -base64 48`.',
  );

  if (claimCodePepper.length < MIN_PEPPER_LENGTH) {
    throw new ServerConfigError(
      `CLAIM_CODE_PEPPER must be at least ${MIN_PEPPER_LENGTH} characters.` +
        ' A short secret leaves claim codes brute-forceable from a stolen' +
        ' table, which is the whole thing it exists to prevent.',
    );
  }

  return { claimCodePepper };
}

function readSupabase(env: RawServerEnv): SupabaseServerConfig {
  if (
    !optionalString(env, 'SUPABASE_SECRET_KEY') &&
    optionalString(env, LEGACY_SECRET_KEY_ENV)
  ) {
    throw new ServerConfigError(
      `${LEGACY_SECRET_KEY_ENV} is set but this project uses the current ` +
        'Supabase key model. Rename it to SUPABASE_SECRET_KEY and use a ' +
        '`sb_secret_...` key from the Supabase dashboard (API Keys).',
    );
  }

  return {
    url: requireString(env, 'SUPABASE_URL'),
    secretKey: requireString(
      env,
      'SUPABASE_SECRET_KEY',
      'This is the `sb_secret_...` key from the Supabase dashboard.',
    ),
    publishableKey: optionalString(env, 'SUPABASE_PUBLISHABLE_KEY'),
  };
}

function readDatabase(env: RawServerEnv): DatabaseConfig {
  const url = requireString(
    env,
    'DATABASE_URL',
    'This is the direct PostgreSQL connection string used for transactional ' +
      'business data; it is separate from SUPABASE_URL.',
  );

  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new ServerConfigError(
      'DATABASE_URL must be a postgres:// or postgresql:// connection string.',
    );
  }

  return {
    url,
    poolMax: readPositiveInt(env, 'DATABASE_POOL_MAX', DEFAULT_POOL_MAX, 1000),
    connectionTimeoutMs: readPositiveInt(
      env,
      'DATABASE_CONNECTION_TIMEOUT_MS',
      DEFAULT_CONNECTION_TIMEOUT_MS,
    ),
    statementTimeoutMs: readPositiveInt(
      env,
      'DATABASE_STATEMENT_TIMEOUT_MS',
      DEFAULT_STATEMENT_TIMEOUT_MS,
    ),
    // Hosted Supabase requires TLS; a local container does not offer it, so the
    // default follows the environment rather than forcing either way.
    ssl: readBoolean(env, 'DATABASE_SSL', readNodeEnv(env) === 'production'),
  };
}

/**
 * Validates the environment and produces the typed config, or throws with an
 * actionable message. Called once, at startup - fail fast beats a half-booted
 * API that dies on the first request.
 */
export function loadServerConfig(
  env: RawServerEnv = process.env,
): ServerConfig {
  return {
    nodeEnv: readNodeEnv(env),
    port: readPort(env),
    corsOrigins: readCorsOrigins(env),
    supabase: readSupabase(env),
    database: readDatabase(env),
    security: readSecurity(env),
  };
}

/** Namespace the config is registered under in NestJS's `ConfigService`. */
export const SERVER_CONFIG_NAMESPACE = 'server';
