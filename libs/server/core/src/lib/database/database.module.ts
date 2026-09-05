import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ServerConfigService } from '../config/server-config.service';
import { DatabaseService } from './database.service';
import { DATABASE_POOL } from './sql-executor';

/**
 * Owns the PostgreSQL connection pool for the whole backend.
 *
 * The pool is created here and nowhere else, for the same reason Supabase
 * initialisation is centralised: connection credentials, pool sizing and
 * timeouts should have exactly one answer.
 *
 * `pg` connects lazily, so constructing the pool does not require the database
 * to be reachable at boot. The first query is where an unreachable database
 * surfaces.
 */
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ServerConfigService],
      useFactory: (config: ServerConfigService): Pool => {
        const { url, poolMax, connectionTimeoutMs, statementTimeoutMs, ssl } =
          config.database;

        return new Pool({
          connectionString: url,
          max: poolMax,
          connectionTimeoutMillis: connectionTimeoutMs,
          // Server-enforced, so a runaway query cannot hold a pooled
          // connection open indefinitely.
          statement_timeout: statementTimeoutMs,
          // Hosted Supabase terminates TLS with a certificate chain that is not
          // in Node's default trust store, hence `rejectUnauthorized: false`.
          // The connection is still encrypted. Supply a CA here if the
          // deployment requires full verification.
          ssl: ssl ? { rejectUnauthorized: false } : false,
        });
      },
    },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
