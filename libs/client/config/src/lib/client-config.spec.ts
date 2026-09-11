import { describe, expect, it } from 'vitest';
import {
  ClientConfigError,
  isSupabaseConfigured,
  readClientConfig,
} from './client-config';

describe('readClientConfig', () => {
  it('falls back to the local API when VITE_API_URL is unset', () => {
    const config = readClientConfig({});

    expect(config.apiUrl).toBe('http://localhost:3000/api/v1');
    expect(config.mobileAppUrl).toBe('http://localhost:4202');
    expect(config.environment).toBe('development');
    expect(isSupabaseConfigured(config)).toBe(false);
  });

  it('reads the public Supabase values', () => {
    const config = readClientConfig({
      VITE_API_URL: 'https://api.example.test/api/v1',
      VITE_MOBILE_APP_URL: 'https://mobile.example.test',
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      VITE_APP_ENV: 'production',
    });

    expect(config.environment).toBe('production');
    expect(config.mobileAppUrl).toBe('https://mobile.example.test');
    expect(isSupabaseConfigured(config)).toBe(true);
    expect(config.supabasePublishableKey).toBe('sb_publishable_test');
  });
});

/**
 * The security rule this library exists to protect: a secret must never reach
 * a browser bundle. Both halves of the guard are covered - the name blocklist
 * and, more importantly, the value-shape check that catches secrets hidden
 * behind an innocent-looking variable name.
 */
describe('assertNoServerSecrets (via readClientConfig)', () => {
  it('rejects a secret key exposed under its own name', () => {
    expect(() =>
      readClientConfig({ VITE_SUPABASE_SECRET_KEY: 'sb_secret_abc123' }),
    ).toThrow(ClientConfigError);
  });

  it('rejects the legacy service-role variable name', () => {
    expect(() =>
      readClientConfig({ VITE_SUPABASE_SERVICE_ROLE_KEY: 'anything' }),
    ).toThrow(ClientConfigError);
  });

  it('rejects a secret key hidden behind an innocuous variable name', () => {
    expect(() =>
      readClientConfig({ VITE_ANALYTICS_TOKEN: 'sb_secret_abc123' }),
    ).toThrow(/looks like a Supabase secret key/);
  });

  it('rejects a database connection string in any VITE_ variable', () => {
    expect(() =>
      readClientConfig({
        VITE_BACKEND: 'postgresql://user:pw@db.example.test:5432/clinic',
      }),
    ).toThrow(/looks like a PostgreSQL connection string/);
  });

  it('never echoes the secret value in the error message', () => {
    const secret = 'sb_secret_do_not_print_me';

    expect(() => readClientConfig({ VITE_ANALYTICS_TOKEN: secret })).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(secret) as unknown as string,
      }) as unknown as Error,
    );
  });

  it('allows the publishable key, which is meant to be public', () => {
    expect(() =>
      readClientConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ok' }),
    ).not.toThrow();
  });

  it('ignores unprefixed variables, which Vite never inlines', () => {
    expect(() =>
      readClientConfig({ SUPABASE_SECRET_KEY: 'sb_secret_server_side' }),
    ).not.toThrow();
  });
});
