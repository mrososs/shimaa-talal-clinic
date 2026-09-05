import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Pool, QueryResult, QueryResultRow } from 'pg';
import { DATABASE_POOL, type SqlExecutor } from './sql-executor';

/**
 * The backend's transactional data access boundary.
 *
 * **Why this exists.** `supabase-js` speaks PostgREST over HTTP. Each call is
 * its own implicit transaction, so several independent statements cannot be
 * grouped into one application-controlled unit of work. Any workflow that must
 * write to more than one table atomically therefore needs a real database
 * connection. This service owns that connection, and it is the only place in
 * the backend that holds one.
 *
 * It is deliberately not a repository, an ORM or a query builder. It gives
 * domain services parameterised SQL and a transaction scope, and nothing else.
 * See docs/database.md.
 */
@Injectable()
export class DatabaseService implements SqlExecutor, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Runs a single statement on a pooled connection.
   *
   * Always pass values as `params` (`$1`, `$2`, ...). String-interpolating user
   * input into `sql` is how SQL injection happens, and no amount of RLS will
   * save you from it.
   */
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, params as unknown[] | undefined);
  }

  /**
   * Runs `work` inside a single database transaction.
   *
   * The callback receives an `SqlExecutor` bound to one connection: every
   * statement issued through it participates in the transaction. Returning
   * normally commits; throwing rolls back and re-throws.
   *
   * Do **not** call `transaction()` again from inside `work` - that would check
   * out a second, independent connection which cannot see the outer
   * transaction's uncommitted rows, and can deadlock against it. Pass the `tx`
   * executor down instead.
   */
  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const result = await work({
        query: <R extends QueryResultRow = QueryResultRow>(
          sql: string,
          params?: readonly unknown[],
        ) => client.query<R>(sql, params as unknown[] | undefined),
      });

      await client.query('COMMIT');
      return result;
    } catch (error) {
      // A failed ROLLBACK must not mask the error that caused it.
      await client.query('ROLLBACK').catch((rollbackError: unknown) => {
        this.logger.error('ROLLBACK failed', rollbackError as Error);
      });

      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
    this.logger.log('Database pool closed');
  }
}
