/**
 * `@clinic/server-core`
 *
 * Backend infrastructure shared by every domain module: configuration,
 * transactional database access, Supabase APIs, token verification and the HTTP
 * response envelope.
 *
 * This library holds no clinic business rules - those belong to the domain
 * libraries under `libs/server/<domain>`.
 */

// config - the only place that reads process.env
export * from './lib/config/server-config';
export * from './lib/config/server-config.module';
export * from './lib/config/server-config.service';

// database - transactional business data access (PostgreSQL)
export * from './lib/database/database.module';
export * from './lib/database/database.service';
export * from './lib/database/sql-executor';

// supabase - Supabase's own APIs (Auth, Storage, Realtime later)
export * from './lib/supabase/supabase.module';
export * from './lib/supabase/supabase.service';

// auth - identity: who is calling. Enforced by default; see SupabaseAuthGuard.
export * from './lib/auth/auth.module';
export * from './lib/auth/authenticated-request';
export * from './lib/auth/authenticated-user';
export * from './lib/auth/cached-token.verifier';
export * from './lib/auth/current-user.decorator';
export * from './lib/auth/public.decorator';
export * from './lib/auth/supabase-auth.guard';
export * from './lib/auth/supabase-token.verifier';
export * from './lib/auth/token-verifier';

// common - shared HTTP concerns
export * from './lib/common/api-exception.filter';
export * from './lib/common/api-response.util';

export * from './lib/server-core.module';
