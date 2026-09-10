import { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { SqlExecutor } from '../database/sql-executor';

/**
 * A real PostgreSQL connection for tests.
 *
 * Domain rules in this platform are enforced by the database as much as by
 * TypeScript — unique indexes decide who wins a race for the last appointment
 * seat, a partial index decides that only one patient is in service at a time.
 * A mocked `SqlExecutor` would assert that the mock behaves as expected and
 * prove nothing about any of that, so domain suites talk to a real server.
 *
 * It lives in `server-core` for the same reason `DatabaseService` does: this is
 * the one library allowed to construct a connection pool, and every server
 * domain needs exactly this harness. It is test-only, and nothing in the
 * application imports it.
 *
 * ## The role
 *
 * Pass a connection string for a role that can create and remove fixtures —
 * `MIGRATION_DATABASE_URL`, not `DATABASE_URL`. The API's `clinic_api` role is
 * deliberately unable to insert a clinic or delete a guardian, which is correct
 * for the application and useless for a test that has to clean up after itself.
 */
export interface TestDatabase {
  /** The same `DatabaseService` the domain services take. */
  readonly database: DatabaseService;

  /**
   * Run work inside a transaction that is always rolled back.
   *
   * The default for anything that only needs to observe a rule: the database
   * enforces every constraint exactly as it would on a real write, and the test
   * leaves nothing behind, so suites cannot pollute each other or the project.
   *
   * Not usable for concurrency: two statements inside one transaction are not
   * two clients racing. Those tests commit, and clean up explicitly.
   */
  rollback<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;

  close(): Promise<void>;
}

export function createTestDatabase(connectionString: string): TestDatabase {
  const pool = new Pool({
    connectionString,
    // Keep database-backed Nx targets below Supabase's per-role session cap.
    max: 5,
    connectionTimeoutMillis: 15_000,
    // Hosted Supabase presents a chain Node does not trust by default. The
    // connection is still encrypted.
    ssl:
      connectionString.includes('localhost') ||
      connectionString.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
  });

  const database = new DatabaseService(pool);

  return {
    database,

    async rollback<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      // A sentinel rather than a flag: DatabaseService rolls back when the
      // callback throws, and rethrows afterwards, so this is the only way to
      // get the rollback without inventing a second transaction helper.
      const abort = Symbol('test-rollback');
      // Boxed rather than a bare `let`, so the compiler can see that a result
      // was produced without an assertion papering over the case where it
      // was not.
      let captured: { value: T } | undefined;

      try {
        await database.transaction(async (tx) => {
          captured = { value: await work(tx) };
          throw abort;
        });
      } catch (error) {
        if (error !== abort) {
          throw error;
        }
      }

      if (captured === undefined) {
        throw new Error('The transaction ended without running its callback.');
      }
      return captured.value;
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}

/**
 * The connection tests should use, or `null` when none is configured.
 *
 * Returning `null` rather than throwing lets a suite skip itself on a machine
 * with no database, instead of failing in a way that looks like a broken test.
 */
export function testDatabaseUrl(): string | null {
  const url =
    process.env['MIGRATION_DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
  return url !== undefined && url.trim() !== '' ? url : null;
}
