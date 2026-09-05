import { ServerConfigError, loadServerConfig } from './server-config';

const MINIMAL_ENV = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SECRET_KEY: 'sb_secret_for_tests',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  CLAIM_CODE_PEPPER: 'a-test-pepper-of-at-least-thirty-two-characters',
  CLINIC_SLUG: 'test-clinic',
};

/** The minimal environment with one required variable removed. */
function envWithout(key: keyof typeof MINIMAL_ENV): Record<string, string> {
  const env: Record<string, string> = { ...MINIMAL_ENV };
  delete env[key];
  return env;
}

/**
 * Architecture-level tests for the server's environment boundary: it must fail
 * fast and explain itself, rather than boot half-configured.
 */
describe('loadServerConfig', () => {
  it('applies defaults around the required values', () => {
    const config = loadServerConfig(MINIMAL_ENV);

    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
    expect(config.corsOrigins).toBe('*');
    expect(config.supabase.publishableKey).toBeNull();
    expect(config.database.poolMax).toBe(10);
    // TLS follows the environment: off locally, on in production.
    expect(config.database.ssl).toBe(false);
  });

  it('parses an explicit port and CORS allow-list', () => {
    const config = loadServerConfig({
      ...MINIMAL_ENV,
      NODE_ENV: 'production',
      API_PORT: '8080',
      API_CORS_ORIGINS: 'https://clinic.example, https://admin.clinic.example',
    });

    expect(config.port).toBe(8080);
    expect(config.nodeEnv).toBe('production');
    expect(config.corsOrigins).toEqual([
      'https://clinic.example',
      'https://admin.clinic.example',
    ]);
    expect(config.database.ssl).toBe(true);
  });

  it('rejects a nonsensical port instead of silently defaulting', () => {
    expect(() =>
      loadServerConfig({ ...MINIMAL_ENV, API_PORT: 'not-a-port' }),
    ).toThrow(ServerConfigError);
  });

  describe('Supabase keys', () => {
    it('refuses to boot without the Supabase secret key', () => {
      expect(() => loadServerConfig(envWithout('SUPABASE_SECRET_KEY'))).toThrow(
        /SUPABASE_SECRET_KEY/,
      );
    });

    // This project is built on the current Supabase key model. Silently
    // accepting the legacy variable would let a stale deployment look healthy.
    it('rejects the legacy service-role variable with migration guidance', () => {
      expect(() =>
        loadServerConfig({
          ...envWithout('SUPABASE_SECRET_KEY'),
          SUPABASE_SERVICE_ROLE_KEY: 'legacy-jwt',
        }),
      ).toThrow(/SUPABASE_SECRET_KEY/);
    });

    it('accepts the optional publishable key for user-scoped clients', () => {
      const config = loadServerConfig({
        ...MINIMAL_ENV,
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_for_tests',
      });

      expect(config.supabase.publishableKey).toBe('sb_publishable_for_tests');
    });
  });

  describe('database', () => {
    it('refuses to boot without a database connection string', () => {
      expect(() => loadServerConfig(envWithout('DATABASE_URL'))).toThrow(
        /DATABASE_URL/,
      );
    });

    it('rejects a connection string that is not PostgreSQL', () => {
      expect(() =>
        loadServerConfig({
          ...MINIMAL_ENV,
          DATABASE_URL: 'https://project.supabase.co',
        }),
      ).toThrow(ServerConfigError);
    });

    it('reads explicit pool and timeout settings', () => {
      const config = loadServerConfig({
        ...MINIMAL_ENV,
        DATABASE_POOL_MAX: '25',
        DATABASE_STATEMENT_TIMEOUT_MS: '5000',
        DATABASE_SSL: 'true',
      });

      expect(config.database.poolMax).toBe(25);
      expect(config.database.statementTimeoutMs).toBe(5000);
      expect(config.database.ssl).toBe(true);
    });

    it('rejects a non-numeric pool size', () => {
      expect(() =>
        loadServerConfig({ ...MINIMAL_ENV, DATABASE_POOL_MAX: 'lots' }),
      ).toThrow(ServerConfigError);
    });
  });

  describe('claim code pepper', () => {
    it('is required, because a claim code is six digits', () => {
      // Without it the stored HMAC degrades to something a leaked table gives
      // up to an offline search in seconds.
      expect(() => loadServerConfig(envWithout('CLAIM_CODE_PEPPER'))).toThrow(
        ServerConfigError,
      );
    });

    it('refuses a short secret rather than pretending it is one', () => {
      expect(() =>
        loadServerConfig({ ...MINIMAL_ENV, CLAIM_CODE_PEPPER: 'too-short' }),
      ).toThrow(/at least 32 characters/);
    });

    it('is exposed on the security section', () => {
      expect(loadServerConfig(MINIMAL_ENV).security.claimCodePepper).toBe(
        MINIMAL_ENV.CLAIM_CODE_PEPPER,
      );
    });
  });

  describe('clinic deployment', () => {
    it('is required, because onboarding has to name a clinic', () => {
      // A parent who has not onboarded has no guardian row to learn a tenant
      // from. Guessing "the only clinic" would break silently the day a second
      // one is added.
      expect(() => loadServerConfig(envWithout('CLINIC_SLUG'))).toThrow(
        ServerConfigError,
      );
    });

    it('is exposed on the clinic section', () => {
      expect(loadServerConfig(MINIMAL_ENV).clinic.slug).toBe('test-clinic');
    });
  });
});
