import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ServerConfigModule } from './config/server-config.module';
import { DatabaseModule } from './database/database.module';
import { SupabaseModule } from './supabase/supabase.module';

/**
 * The backend's shared infrastructure, assembled once.
 *
 * Domain modules import this and get:
 *   - configuration        (ServerConfigService)
 *   - business data access (DatabaseService, transactional PostgreSQL)
 *   - Supabase APIs        (SupabaseService: Auth, Storage, Realtime later)
 *   - token verification   (TOKEN_VERIFIER)
 *
 * They never wire infrastructure themselves.
 */
@Module({
  imports: [ServerConfigModule, DatabaseModule, SupabaseModule, AuthModule],
  exports: [ServerConfigModule, DatabaseModule, SupabaseModule, AuthModule],
})
export class ServerCoreModule {}
