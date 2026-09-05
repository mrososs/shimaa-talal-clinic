import type { QueryResult, QueryResultRow } from 'pg';

/**
 * Re-exported so domain libraries can type their queries without importing
 * `pg` directly. Lint bans `pg` outside this library, which is what keeps the
 * process to exactly one connection pool.
 */
export type { QueryResult, QueryResultRow } from 'pg';

/**
 * Anything that can run SQL: the connection pool, or a single connection that
 * is inside an open transaction.
 *
 * Domain services should depend on **this interface**, not on
 * `DatabaseService`. That is what lets the same repository method be called
 * standalone or as one step of a larger transaction:
 *
 * ```ts
 * // in a domain service
 * async findById(id: string, db: SqlExecutor = this.database) { ... }
 *
 * // an orchestrating workflow spanning two domains, atomically
 * await this.database.transaction(async (tx) => {
 *   await this.appointments.confirm(id, tx);
 *   await this.payments.record(id, tx);
 * });
 * ```
 *
 * See docs/cross-domain-orchestration.md.
 */
export interface SqlExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

/**
 * Injection token for the `pg` connection pool.
 *
 * Exposed so the pool can be substituted in tests, and so that exactly one
 * place in the backend constructs it.
 */
export const DATABASE_POOL = Symbol('DATABASE_POOL');
